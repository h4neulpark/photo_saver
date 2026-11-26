"""Read-only HA observation cache, independent of durable wake operations."""
import asyncio
import ipaddress
import time
from datetime import datetime, timezone
from uuid import uuid4

import settings
from storage_wake import base_configuration, isolated_io, Interrupted, stale_seconds


def ssh_address():
    """Read only the address file; status never takes settings/catalog locks."""
    try:
        return str(ipaddress.ip_address(settings.ADDRESS_FILE.read_text().strip()))
    except (OSError, ValueError, UnicodeError):
        return None


def stamp(value):
    try:
        if not isinstance(value, str) or len(value) > 128:
            return None
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, OverflowError):
        return None


class StatusService:
    def __init__(self, runner=isolated_io, config=base_configuration,
                 wall=time.time, monotonic=time.monotonic, ssh_address=ssh_address, ssh_probe=None):
        self.runner, self.config = runner, config
        self.ssh_address, self.ssh_probe = ssh_address, ssh_probe
        self.wall, self.monotonic = wall, monotonic
        self.lock = asyncio.Lock()
        self.key = None
        self.revision = None
        self.task = self.record = self.last_known = None
        self.started = float('-inf')
        self.completed = 0

    def identity(self, config):
        return tuple(config[k] for k in ('url', 'token', 'sensor', 'reason')) + (self.ssh_address(), stale_seconds())

    def source(self, config):
        key = self.identity(config)
        if key != self.key:
            self.key, self.revision = key, uuid4().hex
            self.address, self.stale_seconds = key[-2:]
            self.record = self.last_known = self.task = None
            self.started = float('-inf')
        return key

    def project(self, record, cached=False):
        observation, fetched = record if record else ({}, None)
        now = datetime.fromtimestamp(self.wall(), timezone.utc)
        raw = observation.get('state') if observation.get('state') in ('on', 'off', 'unknown', 'unavailable') else None
        source = 'last_reported' if observation.get('last_reported_present', 'last_reported' in observation) else 'last_updated'
        reported = stamp(observation.get(source))
        reason = observation.get('reason')
        limit = getattr(self, 'stale_seconds', stale_seconds())
        fresh = None if limit == 0 else 0
        ha_status = 'unknown'
        if reason:
            ha_status = 'unconfigured' if reason == 'ha_not_configured' else 'error'
        elif raw in ('unknown', 'unavailable'):
            reason = 'sensor_' + raw
        elif raw in ('on', 'off'):
            age = (now - reported).total_seconds() if reported else None
            if age is None:
                ha_status, reason = 'stale', 'report_time_invalid'
            elif age < -30:
                ha_status, reason = 'stale', 'report_time_future'
            elif limit > 0 and age > limit:
                ha_status, reason = 'stale', 'report_stale'
            else:
                ha_status = raw
                fresh = max(0, min(limit, limit - age)) if limit else None
        else:
            ha_status, reason = 'error', 'ha_response_invalid'
        ssh = observation.get('ssh') or dict(configured=False, status='unconfigured', latencyMs=None)
        reachable = ssh['status'] == 'reachable'
        if ha_status == 'on':
            status, top_reason = ('booting', 'ssh_unreachable') if ssh['status'] == 'unreachable' else ('running', None)
        elif ha_status == 'off':
            status, top_reason = ('running', 'ha_lagging') if reachable else ('no_response', None)
        elif ha_status == 'unconfigured':
            status, top_reason = (('running', None) if reachable else ('no_response', None)
                                  if ssh['configured'] else ('unconfigured', 'ha_not_configured'))
        elif ha_status == 'stale':
            status, top_reason = ('running', None) if reachable else ('stale', reason)
        else:
            status, top_reason = ('running' if reachable else 'unknown', reason)
        changed = stamp(observation.get('last_changed'))
        changed = changed.isoformat() if changed else None
        reported_at = reported.isoformat() if reported else None
        return dict(status=status, reasonCode=top_reason, rawState=raw, fetchedAt=fetched,
                    checkedAt=now.isoformat(), reportedAt=reported.isoformat() if reported else None,
                    reportedAtSource=source if reported else None, cached=cached,
                    sourceRevision=self.revision, freshForSeconds=fresh,
                    changedAt=changed,
                    ha=dict(configured=ha_status != 'unconfigured', status=ha_status, reasonCode=reason,
                            reportedAt=reported_at, changedAt=changed), ssh=ssh,
                    nextPollInSeconds=1 if reason == 'config_changed' else {
                        'booting': 5, 'running': 15, 'no_response': 15, 'unknown': 30,
                        'stale': 30, 'unconfigured': 60}[status],
                    refreshAvailableInSeconds=max(0, min(5, 5 - (self.monotonic() - self.started))),
                    lastKnown=self.last_known)

    def read(self, config):
        deadline = self.monotonic() + 4.5
        def control():
            if self.monotonic() >= deadline:
                raise Interrupted('ha_timeout')
        return self.runner(dict(operation='get', ha=config, entity=config['sensor'],
                                statusProjection=True, deadline=self.wall() + 4.5), control)

    def probe(self, address):
        deadline = self.monotonic() + 2.5
        def control():
            if self.monotonic() >= deadline:
                raise Interrupted('deadline')
        result = (self.ssh_probe or self.runner)(dict(operation='ssh_banner', address=address,
                                deadline=self.wall() + 2.5), control)
        reachable = result.get('status') == 'reachable'
        return dict(configured=True, status='reachable' if reachable else 'unreachable',
                    latencyMs=result.get('latencyMs') if reachable else None)

    async def fetch(self, config, key, revision):
        try:
            async def ha_read():
                if config['reason']:
                    return {'reason': config['reason']}
                try:
                    result = await asyncio.to_thread(self.read, config)
                except Interrupted as exc:
                    return {'reason': 'ha_timeout' if exc.reason == 'ha_timeout' else 'ha_unreachable'}
                except Exception:
                    return {'reason': 'ha_unreachable'}
                if result.get('status') != 'ok':
                    code = result.get('code')
                    reason = {'ha_http_401': 'ha_auth_error', 'ha_http_403': 'ha_auth_error',
                              'ha_http_404': 'sensor_missing'}.get(code)
                    if code in ('ha_tls_error', 'ha_dns_error', 'ha_timeout', 'ha_unreachable', 'ha_redirect_blocked', 'ha_http_5xx'):
                        reason = code
                    elif isinstance(code, str) and code.startswith('ha_http_5'):
                        reason = 'ha_http_5xx'
                    elif code in ('ha_http_301', 'ha_http_302', 'ha_http_303', 'ha_http_307', 'ha_http_308'):
                        reason = 'ha_redirect_blocked'
                    result = {'reason': reason or ('ha_timeout' if result.get('status') == 'expired' else
                              'ha_unreachable' if not code and result.get('status') == 'unreachable' else 'ha_response_invalid')}
                return result
            async def ssh_read():
                if not key[-2]:
                    return dict(configured=False, status='unconfigured', latencyMs=None)
                try:
                    return await asyncio.to_thread(self.probe, key[-2])
                except Exception:
                    return dict(configured=True, status='unreachable', latencyMs=None)
            result, ssh = await asyncio.gather(ha_read(), ssh_read())
            result = dict(result, ssh=ssh)
            async with self.lock:
                self.source(self.config())
                if key != self.key or revision != self.revision:
                    return None
                self.record = (result, datetime.fromtimestamp(self.wall(), timezone.utc).isoformat())
                self.completed = self.monotonic()
                projected = self.project(self.record)
                if projected['ha']['status'] in ('on', 'off'):
                    self.last_known = {k: projected[k] for k in ('rawState', 'reportedAt', 'fetchedAt')}
                return self.record
        finally:
            async with self.lock:
                if self.task is asyncio.current_task():
                    self.task = None

    async def get(self, refresh=False):
        async with self.lock:
            config = self.config()
            key = self.source(config)
            revision = self.revision
            if config['reason'] and not self.address:
                return self.project(({'reason': config['reason']}, None))
            if self.task is None:
                ttl = self.project(self.record)['nextPollInSeconds'] if self.record else 15
                age = self.monotonic() - self.completed
                if self.record and ((refresh and self.monotonic() - self.started < 5) or (not refresh and age < ttl)):
                    return self.project(self.record, True)
                self.started = self.monotonic()
                self.task = asyncio.create_task(self.fetch(config, key, revision))
            task = self.task
        try:
            record = await asyncio.wait_for(asyncio.shield(task), 5.5)
        except asyncio.TimeoutError:
            record = ({'reason': 'status_busy'}, None)
        async with self.lock:
            self.source(self.config())
            if key != self.key or revision != self.revision or record is None:
                return self.project(({'reason': 'config_changed'}, None))
            return self.project(record, False)


service = StatusService()
