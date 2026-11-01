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
- AT and DE reference mails go over our own SMTP servers (src/lib/smtp.server.ts; AT s4.meinehp.at, DE s5.meinehp.at, port 465) with per-country signature + photo attachments; Pipedrive mail API needs OAuth mail scope, so it is not used.
