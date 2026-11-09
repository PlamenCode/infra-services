#!/bin/sh
set -eu

# LinuxServer executes /custom-cont-init.d after its application setup.
# Limit PHP concurrency before accepting requests on this small shared node.
found=0
for pool in /etc/php*/php-fpm.d/www.conf; do
  [ -f "$pool" ] || continue
  found=1
  sed -i \
    -e 's/^pm = .*/pm = ondemand/' \
    -e 's/^pm.max_children = .*/pm.max_children = 2/' \
    -e '/^pm.process_idle_timeout[[:space:]]*=/d' \
    -e '/^pm.max_requests[[:space:]]*=/d' \
    "$pool"
  printf '\npm.process_idle_timeout = 10s\npm.max_requests = 100\n' >> "$pool"
done
[ "$found" -eq 1 ] || { echo 'PHP-FPM configuration was not found' >&2; exit 1; }

for ini_dir in /etc/php*/conf.d; do
  [ -d "$ini_dir" ] || continue
  cat > "$ini_dir/99-piwigo-resource-limits.ini" <<'EOF'
memory_limit=128M
upload_max_filesize=100M
post_max_size=110M
max_execution_time=120
EOF
done

echo 'Piwigo resource settings: two on-demand PHP workers, 128M per PHP request'
