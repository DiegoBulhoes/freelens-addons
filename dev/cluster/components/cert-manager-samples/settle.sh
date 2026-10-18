# The certificates the suites renew are issued and idle; renewal-stalls shows as failing.

issued() { # certificate
  local state
  state="$(kubectl -n demo get certificate "$1" \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}/{.status.conditions[?(@.type=="Issuing")].status}')"
  [[ "${state}" == "True/" ]]
}

# 900s is RENEWAL_GRACE_MS in packages/cert-manager/src/renderer/api/certificates/expiry.ts.
renewal_failing() {
  local ready renewal
  read -r ready renewal <<< "$(kubectl -n demo get certificate renewal-stalls \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status} {.status.renewalTime}')"
  [[ "${ready}" == True && -n "${renewal}" ]] && (($(date +%s) > $(date -d "${renewal}" +%s) + 900))
}

# Being issued: acme-web's Ingress serves a Secret its Certificate has not written.
being_issued() {
  kubectl -n demo get certificate acme-web && kubectl -n demo get ingress acme-web \
    && ! kubectl -n demo get secret acme-web
}

# Left behind: retired-tls's Secret names a Certificate that is gone.
left_behind() {
  [[ "$(kubectl -n demo get secret retired-tls \
    -o jsonpath='{.metadata.annotations.cert-manager\.io/certificate-name}')" == retired-tls ]] \
    && ! kubectl -n demo get certificate retired-tls
}

# Issued on a broken issuer: Ready, and not issuing.
valid_on_broken_issuer() {
  local state
  state="$(kubectl -n demo get certificate issuer-broken \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}/{.status.conditions[?(@.type=="Issuing")].status}')"
  [[ "${state}" == "True/" || "${state}" == "True/False" ]] \
    && [[ "$(kubectl -n demo get issuer flaky-ca -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')" == False ]]
}

# Out of date: not ready for its current spec, the old certificate still valid, a failed issue recorded.
out_of_date() {
  local generation observed ready not_after attempts failed
  IFS=/ read -r generation observed ready not_after attempts failed <<< "$(kubectl -n demo \
    get certificate out-of-date -o jsonpath='{.metadata.generation}/{.status.conditions[?(@.type=="Ready")].observedGeneration}/{.status.conditions[?(@.type=="Ready")].status}/{.status.notAfter}/{.status.failedIssuanceAttempts}/{.status.lastFailureTime}')"
  [[ "${observed}" == "${generation}" && "${ready}" == False && "${attempts:-0}" -ge 1 && -n "${failed}" ]] \
    && [[ -n "${not_after}" ]] && (($(date -d "${not_after}" +%s) > $(date +%s)))
}

echo "==> Waiting for the certificates to be issued"
for certificate in web-tls ends-this-month ends-this-week managed-tls; do retry issued "${certificate}"; done

echo "==> Waiting for renewal-stalls to show as failing, 18 minutes after its issue"
retry_for 1500 renewal_failing

echo "==> Waiting for acme-web to be served while being issued, and retired-tls to be left behind"
retry being_issued
retry left_behind

echo "==> Waiting for issuer-broken to stay valid on flaky-ca, and out-of-date to have failed its new issue"
retry valid_on_broken_issuer
retry out_of_date
