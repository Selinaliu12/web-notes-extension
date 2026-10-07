import os, struct, zlib

def png(n):
    rows = []
    rr = .22
    for y in range(n):
        r = bytearray([0])
        for x in range(n):
            cx, cy = (x + .5) / n - .5, (y + .5) / n - .5
            ax, ay = abs(cx) - (.5 - rr), abs(cy) - (.5 - rr)
            if (max(ax, 0) ** 2 + max(ay, 0) ** 2) > rr * rr:
                r += bytes([0, 0, 0, 0])
            elif -.12 < cy < .12 and -.3 < cx < .3:
                r += bytes([255, 214, 10, 255])
            else:
                r += bytes([10, 102, 214, 255])
        rows.append(bytes(r))
    raw = b''.join(rows)
    def ch(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0))
            + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b''))

os.makedirs('extension/icons', exist_ok=True)
for n in (16, 32, 48, 128):
    open(f'extension/icons/{n}.png', 'wb').write(png(n))
print('icons ok')
