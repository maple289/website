"""TURN UDP/TCP allocation validation. Credentials arrive on stdin, never argv.

Print only allocation status/address/port. This is not a media call or an
external test unless the operator runs it from an external network.
"""
import hashlib
import hmac
import ipaddress
import json
import os
import socket
import struct
import sys

COOKIE = 0x2112A442

def attribute(kind, value):
    return struct.pack('!HH', kind, len(value)) + value + b'\0' * (-len(value) % 4)

def packet(kind, transaction, attributes, key=None):
    body = b''.join(attributes)
    header = struct.pack('!HHI', kind, len(body) + (24 if key else 0), COOKIE) + transaction
    if key:
        body += attribute(0x0008, hmac.new(key, header + body, hashlib.sha1).digest())
    return header + body

def receive(sock, tcp):
    if not tcp:
        return sock.recv(65536)
    def take(count):
        result = b''
        while len(result) < count:
            part = sock.recv(count - len(result))
            if not part:
                raise RuntimeError('connection_closed')
            result += part
        return result
    header = take(20)
    return header + take(struct.unpack('!H', header[2:4])[0])

def parse(data, transaction):
    if len(data) < 20 or data[8:20] != transaction or struct.unpack('!I', data[4:8])[0] != COOKIE:
        raise RuntimeError('invalid_turn_response')
    result = {}
    offset = 20
    while offset + 4 <= len(data):
        kind, length = struct.unpack('!HH', data[offset:offset+4])
        if offset + 4 + length > len(data):
            raise RuntimeError('truncated_turn_response')
        result[kind] = data[offset+4:offset+4+length]
        offset += 4 + length + (-length % 4)
    return struct.unpack('!H', data[:2])[0], result

def allocate(host, port, transport, username, credential):
    tcp = transport == 'tcp'
    address = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM if tcp else socket.SOCK_DGRAM)[0][4]
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM if tcp else socket.SOCK_DGRAM) as sock:
        sock.settimeout(8); sock.connect(address)
        transaction = os.urandom(12)
        requested = [attribute(0x0019, b'\x11\0\0\0')]
        sock.sendall(packet(0x0003, transaction, requested))
        kind, values = parse(receive(sock, tcp), transaction)
        if kind != 0x0113 or 0x0014 not in values or 0x0015 not in values:
            raise RuntimeError('authenticated_challenge_missing')
        key = hashlib.md5(username.encode() + b':' + values[0x0014] + b':' + credential.encode()).digest()
        authenticated = requested + [attribute(0x0006, username.encode()), attribute(0x0014, values[0x0014]), attribute(0x0015, values[0x0015])]
        transaction = os.urandom(12)
        sock.sendall(packet(0x0003, transaction, authenticated, key))
        kind, response = parse(receive(sock, tcp), transaction)
        if kind != 0x0103 or 0x0016 not in response:
            error = response.get(0x0009, b'\0' * 4)
            raise RuntimeError('allocation_rejected_' + str((error[2] & 7) * 100 + error[3]))
        relay = response[0x0016]
        if len(relay) < 8 or relay[1] != 1:
            raise RuntimeError('unexpected_relay_address_family')
        relay_port = struct.unpack('!H', relay[2:4])[0] ^ (COOKIE >> 16)
        relay_ip = str(ipaddress.IPv4Address(struct.unpack('!I', relay[4:8])[0] ^ COOKIE))
        # Explicit zero-lifetime refresh releases the allocation immediately.
        refresh = [attribute(0x000d, struct.pack('!I', 0))] + authenticated[1:]
        sock.sendall(packet(0x0004, os.urandom(12), refresh, key))
        return {'transport': transport, 'status': 'passed', 'relay_address': relay_ip, 'relay_port': relay_port}

if __name__ == '__main__':
    request = json.load(sys.stdin)
    failed = False
    for transport in ['udp', 'tcp']:
        try:
            result = allocate(request['host'], int(request.get('port', 3478)), transport, request['username'], request['credential'])
            if not 50000 <= result['relay_port'] <= 50100:
                raise RuntimeError('relay_port_outside_expected_range')
            print(json.dumps(result))
        except Exception as cause:
            failed = True
            # Do not print exception values that might contain credentials.
            print(json.dumps({'transport': transport, 'status': 'failed', 'category': type(cause).__name__}))
    sys.exit(1 if failed else 0)
