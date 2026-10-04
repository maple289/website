"""Small Ubuntu counter sampler; no process inspection or storage traversal."""
import json
import logging
import pathlib
import time

SAMPLE_INTERVAL = 3


def cpu_counters(path=pathlib.Path('/host-proc/stat')):
    counters = {}
    for line in path.read_text().splitlines():
        fields = line.split()
        if not fields or not fields[0].startswith('cpu') or not fields[0][3:].isdigit():
            continue
        values = [int(value) for value in fields[1:9]]
        if len(values) < 4 or any(value < 0 for value in values):
            raise ValueError('Invalid CPU counters')
        # guest/guest_nice are already included in user/nice, so omit them.
        idle = values[3] + (values[4] if len(values) > 4 else 0)
        counters[int(fields[0][3:])] = (sum(values), idle)
    if not counters:
        raise ValueError('CPU counters unavailable')
    return counters


def memory_usage(path=pathlib.Path('/host-proc/meminfo')):
    values = {}
    for line in path.read_text().splitlines():
        fields = line.split()
        if len(fields) >= 2:
            values[fields[0].rstrip(':')] = int(fields[1]) * 1024
    total = values.get('MemTotal', 0)
    available = values.get('MemAvailable')
    if available is None:
        available = sum(values.get(key, 0) for key in ['MemFree', 'Buffers', 'Cached', 'SReclaimable']) - values.get('Shmem', 0)
    if total <= 0:
        raise ValueError('Memory counters unavailable')
    used = total - max(0, min(total, available))
    return {'memoryUsedBytes': used, 'memoryTotalBytes': total,
            'memoryPercent': round(used / total * 100, 1)}


def cpu_usage(previous, current):
    cpus, total_delta, idle_delta = [], 0, 0
    for cpu_id, (total, idle) in sorted(current.items()):
        usage = None  # Newly online/reset CPUs need a second reading.
        if cpu_id in previous:
            delta = total - previous[cpu_id][0]
            idle_change = idle - previous[cpu_id][1]
            if delta > 0 and idle_change >= 0:
                idle_change = min(delta, idle_change)
                usage = round((delta - idle_change) / delta * 100, 1)
                total_delta += delta
                idle_delta += idle_change
        cpus.append({'id': cpu_id, 'usage': usage})
    return {'cpuOverall': round((total_delta - idle_delta) / total_delta * 100, 1) if total_delta else None,
            'cpuCount': len(cpus), 'cpus': cpus}


def monitor(store, stop, proc_root=pathlib.Path('/host-proc'), heartbeat=pathlib.Path('/tmp/system-load-heartbeat')):
    previous, previous_time, reported_count, last_error = None, None, None, None
    deadline = time.monotonic()
    while not stop.wait(max(0, deadline - time.monotonic())):
        deadline = time.monotonic() + SAMPLE_INTERVAL
        try:
            current = cpu_counters(proc_root / 'stat')
            sampled_at = time.monotonic()
            memory = memory_usage(proc_root / 'meminfo')
            if previous is not None:
                data = {**cpu_usage(previous, current), **memory,
                        'sampleSeconds': round(sampled_at - previous_time, 3)}
                store('analytics_store_system_load', {'p_data': data})
                heartbeat.touch()
                if data['cpuCount'] != reported_count:
                    logging.info(json.dumps({'operation': 'system_load_collection', 'result': 'online', 'cpu_count': data['cpuCount']}))
                    reported_count = data['cpuCount']
                last_error = None
            previous, previous_time = current, sampled_at
        except Exception as error:
            previous, previous_time = None, None
            # No exception text, paths, request headers or secrets in logs.
            if last_error is None or time.monotonic() - last_error >= 60:
                response = getattr(error, 'response', None)
                logging.error(json.dumps({'operation': 'system_load_collection', 'result': 'failed',
                                          'type': type(error).__name__, 'status': response.status_code if response is not None else None}))
                last_error = time.monotonic()
