<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- AT reference mails go over our own S4 SMTP server (src/lib/smtp.server.ts, host s4.meinehp.at:465 whose TLS cert matches) with signature + photo attachments listed in reference-mail-attachments.json; Pipedrive mail API needs OAuth mail scope, so it is not used.
