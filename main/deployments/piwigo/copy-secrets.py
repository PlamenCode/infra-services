"""Copy existing Immich Secrets to Piwigo names, without exposing their values."""
import json
import subprocess
import sys

NAMESPACE = "services"
MAPPINGS = (
    ("immich-prod", "piwigo-prod", ("USERNAME", "PASSWORD", "DB_PASSWORD")),
    ("immich-storagebox", "piwigo-storagebox", ("username", "password")),
)


def kubectl(*args, input_text=None):
    result = subprocess.run(
        ["kubectl", "-n", NAMESPACE, *args],
        input=input_text, text=True, capture_output=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "kubectl failed")
    return result.stdout


def main():
    pending = []
    # Validate both sources/targets before creating either destination.
    for source, target, required in MAPPINGS:
        old = json.loads(kubectl("get", "secret", source, "-o", "json"))
        data = old.get("data", {})
        for key in required:
            if not data.get(key):
                raise RuntimeError(f"{source} is missing required key {key}")
        copied_data = {key: data[key] for key in required}
        if source == "immich-storagebox" and "domain" in data:
            copied_data["domain"] = data["domain"]
        existing = kubectl("get", "secret", target, "--ignore-not-found", "-o", "json").strip()
        if existing:
            if json.loads(existing).get("data", {}) != copied_data:
                raise RuntimeError(f"{target} already exists with different data; refusing to overwrite it")
            print(f"{target}: already contains the copied credentials")
            continue
        pending.append({
            "apiVersion": "v1", "kind": "Secret", "type": "Opaque",
            "metadata": {"name": target, "namespace": NAMESPACE},
            "data": copied_data,
        })
    if pending:
        output = kubectl("create", "-f", "-", input_text=json.dumps({
            "apiVersion": "v1", "kind": "List", "items": pending,
        }))
        print(output.strip())
    print("Original Immich Secrets were retained. No secret values were printed.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Secret copy failed: {error}", file=sys.stderr)
        sys.exit(1)
