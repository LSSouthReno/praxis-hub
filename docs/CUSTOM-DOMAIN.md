# Putting the hub on its own web address

Nothing is bought or switched on yet. When the domain exists (for example practicehub.com):

1. Rename `CNAME.placeholder` to `CNAME` (no extension) and make sure it holds only the domain name, one line. Commit and push.
2. In the domain registrar's DNS settings, add the four GitHub Pages `A` records for the apex domain (185.199.108.153, .109.153, .110.153, .111.153) and a `CNAME` record for `www` pointing to `lssouthreno.github.io`. GitHub's current list is at docs.github.com under "Managing a custom domain for your GitHub Pages site".
3. In the repo's Settings → Pages, enter the domain and tick **Enforce HTTPS** once the certificate appears (a few minutes to a day).
4. The board sign-in needs HTTPS, so do not skip step 3.

Do not rename `CNAME.placeholder` before the domain is registered: a `CNAME` file pointing at a domain that is not set up breaks the current address.

## Who owns the hosting

The site is built from this repo (LSSouthReno/praxis-hub). Options discussed on the call: keep hosting it here; create a separate GitHub account for Praxis and move the repo (Settings → Transfer); or export a copy for someone else to host. Moving later is a small job, and the custom domain moves with the `CNAME` file.
