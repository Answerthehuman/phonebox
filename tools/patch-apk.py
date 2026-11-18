"""Copy the original APK, swapping its assets/www for the working tree's. The signature is added afterwards."""
import sys, zipfile, os
src, www, out = sys.argv[1:4]
zin = zipfile.ZipFile(src)
new = {}
for root, _, files in os.walk(www):
    for f in files:
        full = os.path.join(root, f)
        new['assets/www/' + os.path.relpath(full, www).replace(os.sep, '/')] = full
old_www = {i.filename for i in zin.infolist() if i.filename.startswith('assets/www/')}
with zipfile.ZipFile(out, 'w') as zout:
    for i in zin.infolist():
        n = i.filename
        if n.startswith('META-INF/') and n.rsplit('/', 1)[-1] in ('MANIFEST.MF', 'CERT.SF', 'CERT.RSA'): continue   # old v1 signature
        if n.startswith('assets/www/'): continue
        zi = zipfile.ZipInfo(n, date_time=i.date_time); zi.compress_type = i.compress_type; zi.external_attr = i.external_attr
        zout.writestr(zi, zin.read(n))
    for n, full in sorted(new.items()):
        zi = zipfile.ZipInfo(n, date_time=(2026, 11, 18, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED
        zout.writestr(zi, open(full, 'rb').read())
print('replaced', len(old_www), 'asset files with', len(new), '(new: %s)' % sorted(set(new) - old_www))
