"""Private single-operation helper; input/response are restricted JSON pipes."""
import json
import os
import re
import ssl
import socket
import stat
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def operation(request):
    if time.time() >= request['deadline']:
        return {'status': 'expired', 'code': 'ha_timeout'}
    if request['operation'] == 'ssh_banner':
        started = time.monotonic()
        try:
            with socket.create_connection((request['address'], 22), timeout=1.5) as connection:
                banner = connection.recv(256).split(b'\n', 1)[0]
                if banner.startswith(b'SSH-'):
                    return {'status': 'reachable', 'latencyMs': round((time.monotonic() - started) * 1000, 1)}
        except OSError:
            pass
        return {'status': 'unreachable', 'latencyMs': None}
    if request['operation'] == 'ssh':
        import archive
        from fastapi import HTTPException
        from storage_wake import snapshot_lock, unlocked_snapshot
        try:
            with snapshot_lock(timeout=.5):
                if unlocked_snapshot()['storageRevision'] != request['storageRevision']:
                    return {'status': 'config_changed'}
                config = archive.archive_config()
                if not archive.settings.known_host_file(config['address']).is_file():
                    return {'status': 'host_key_error'}
            with archive.archive_connection(config) as (sftp, _):
                root = sftp.normalize(config['root'])
                if not stat.S_ISDIR(sftp.stat(root).st_mode):
                    return {'status': 'not_directory'}
                listing = sftp.listdir_iter(root, read_aheads=1)
                try:
                    next(listing, None)
                finally:
                    listing.close()
            return {'status': 'ready', 'revision': archive.archive_revision(config)}
        except HTTPException as exc:
            if exc.status_code == 502 and getattr(exc, "archive_failure", None) == "sftp":
                return {"status": "sftp_error"}
            return {'status': {401: 'auth_failed', 409: 'host_key_error', 404: 'path_missing',
                               403: 'permission_denied', 400: 'not_directory'}.get(exc.status_code, 'unreachable')}
        except Exception:
            return {'status': 'unreachable'}
    if request['operation'] == 'get_many':
        request = dict(request, deadline=min(request['deadline'], time.time() + 4.5))
        entities = request.get('entities')
        if not isinstance(entities, list) or not 1 <= len(entities) <= 4 or not all(isinstance(e, str) for e in entities):
            return {'status': 'invalid_response', 'code': 'ha_config_invalid'}
        results = {}
        for entity in entities:
            result = _get_entity(dict(request, entity=entity))
            results[entity] = result
            if (result.get('code') in ('ha_http_401', 'ha_http_403', 'ha_dns_error', 'ha_tls_error',
                                       'ha_redirect_blocked', 'ha_timeout', 'ha_unreachable') or
                    result.get('status') in ('expired', 'unreachable')):
                # Carry the shared failure forward without another HTTP request.
                results.update({e: dict(result) for e in entities if e not in results})
                break
        return {'status': 'ok', 'entities': results}
    if request['operation'] == 'get':
        return _get_entity(request)
    return _ha_request(request)


def _get_entity(request):
    return _ha_request(dict(request, operation='get'))


def _ha_request(request):
    ha = request['ha']
    post = request['operation'] == 'post'
    if post:
        service = request.get('service', 'script/turn_on')
        entity = request.get('entity', ha.get('script'))
        if (service not in ('script/turn_on', 'switch/turn_on', 'switch/turn_off') or
                not isinstance(entity, str) or not entity.startswith(service.split('/')[0] + '.') or
                not re.fullmatch(r'(script|switch)\.[a-z0-9_]+', entity)):
            return {'status': 'rejected', 'code': 'ha_config_invalid'}
    path = '/api/services/' + service if post else '/api/states/' + request['entity']
    data = json.dumps({'entity_id': entity}).encode() if post else None
    req = urllib.request.Request(ha['url'] + path, data=data,
                                 headers={'Authorization': 'Bearer ' + ha['token'], 'Content-Type': 'application/json'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        if time.time() >= request['deadline']:
            return {'status': 'expired', 'code': 'ha_timeout'}
        with opener.open(req, timeout=max(.01, min(5, request['deadline'] - time.time()))) as response:
            if post:
                return {'status': 'accepted' if response.status == 200 else 'unknown'}
            if getattr(response, 'status', 200) != 200:
                return {'status': 'invalid_response' if request.get('statusProjection') else 'unreachable'}
            raw = response.read(65537)
            if len(raw) > 65536:
                return {'status': 'invalid_response' if request.get('statusProjection') else 'unreachable'}
            value = json.loads(raw)
            if not isinstance(value, dict) or value.get('entity_id') != request['entity']:
                return {'status': 'invalid_response' if request.get('statusProjection') else 'unreachable'}
            if value.get('state') not in ('on', 'off', 'unknown', 'unavailable'):
                return {'status': 'invalid_response' if request.get('statusProjection') else 'unreachable'}
            result = {'status': 'ok', 'state': value['state']}
            for key in ('last_reported', 'last_updated', 'last_changed'):
                if request.get('statusProjection'):
                    result[key + '_present'] = key in value
                stamp = value.get(key)
                try:
                    if not isinstance(stamp, str) or len(stamp) > 128:
                        raise ValueError()
                    parsed = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
                    if parsed.tzinfo:
                        result[key] = parsed.isoformat()
                except (ValueError, TypeError, AttributeError):
                    pass
            return result
    except (ValueError, TypeError):
        return {'status': 'invalid_response' if request.get('statusProjection') else ('unknown' if post else 'unreachable'), 'code': 'ha_response_invalid'}
    except urllib.error.HTTPError as exc:
        return {'status': ('rejected' if post else 'ha_error') if exc.code in (400, 401, 403, 404) or not post and exc.code in (301, 302, 303, 307, 308)
                else ('unknown' if post else 'unreachable'), 'code': (
                    'ha_redirect_blocked' if exc.code in (301, 302, 303, 307, 308) else
                    'ha_http_5xx' if exc.code >= 500 else 'ha_http_' + str(exc.code))}
    except urllib.error.URLError as exc:
        return transport_error(exc.reason, post)
    except Exception as exc:
        return transport_error(exc, post)


def transport_error(exc, post):
    code = ('ha_tls_error' if isinstance(exc, ssl.SSLError) else
            'ha_dns_error' if isinstance(exc, socket.gaierror) else
            'ha_timeout' if isinstance(exc, TimeoutError) else 'ha_unreachable')
    status = 'ha_error' if code in ('ha_tls_error', 'ha_dns_error') else 'unreachable'
    return {'status': 'unknown' if post else status, 'code': code}


def main():
    request = json.loads(sys.stdin.readline(131072))
    max_slice = {'ssh': 12, 'ssh_banner': 2.5, 'get_many': 4.5}.get(request.get('operation'), 5)
    cap = max(.001, min(max_slice, request['deadline'] - time.time()))
    watchdog = threading.Timer(cap, lambda: os._exit(124))
    watchdog.daemon = True
    watchdog.start()
    try:
        print(json.dumps(operation(request)), flush=True)
    finally:
        watchdog.cancel()


if __name__ == '__main__':
    main()
