# The certificates the suites renew are issued and idle; renewal-stalls shows as failing.

issued() { # certificate
  local state
  state="$(kubectl -n demo get certificate "$1" \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}/{.status.conditions[?(@.type=="Issuing")].status}')"
  [[ "${state}" == "True/" ]]
}

# 900s is RENEWAL_GRACE_MS in packages/cert-manager/src/renderer/api/expiry.ts.
renewal_failing() {
  local ready renewal
  read -r ready renewal <<< "$(kubectl -n demo get certificate renewal-stalls \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status} {.status.renewalTime}')"
  [[ "${ready}" == True && -n "${renewal}" ]] && (($(date +%s) > $(date -d "${renewal}" +%s) + 900))
}

echo "==> Waiting for the certificates to be issued"
for certificate in web-tls ends-this-month ends-this-week managed-tls; do retry issued "${certificate}"; done

echo "==> Waiting for renewal-stalls to show as failing, 18 minutes after its issue"
retry_for 1500 renewal_failing
