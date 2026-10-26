# OpenRouter key

The opt-in `openrouter` module keeps one [OpenRouter](https://openrouter.ai) key and one
decision model for the tools that can reach a model through OpenRouter by their own
documented settings. The default model is [Jev](https://openrouter.ai/typesafe/jev-1.13),
TypeSafe's fast structured decision model.

```sh
export OPENROUTER_API_KEY=...        # or leave it unset and paste it on the last screen
./install.sh --modules openrouter,voice-mode
```

The key is read from `OPENROUTER_API_KEY` or pasted hidden on the setup's last screen (at a
terminal, after the install), never from an answers file,
and stored only in `~/.config/ai-workstation-setup/openrouter/.env` (mode 600), outside this
clone. With no key given, the module creates that file empty for you to fill in.
`OPENROUTER_MODEL` sets the model (default `typesafe/jev-1.13`). Keep a versioned model id
such as this one, not a moving alias, so a tool's behavior changes only when you change it.

## Which tools use it

| Tool | Uses the key | How |
| --- | --- | --- |
| Voice mode actions | yes | `actions.chooser.keyFile` points at the key file, and `actions.chooser.model` is `OPENROUTER_MODEL` ([voice mode](voice-mode.md)). |
| [compact-adviser](https://github.com/kunchenguid/compact-adviser) | no | It calls TypeSafe directly and documents no OpenRouter setting. Give it `TYPESAFE_API_KEY` (from the TypeSafe console) instead. |
| Firstmate's typed dispatch resolver (`bin/fm-dispatch-resolve.sh`) | yes, when you opt in, but it reads its own `OPENROUTER_API_KEY` | With `OPENROUTER_FIRSTMATE=yes` the module sets `FM_DISPATCH_PROVIDER=openrouter` and `FM_DISPATCH_MODEL=` your `OPENROUTER_MODEL` in the Firstmate home's `.env`, and leaves every other line of that file as it is. The home is `OPENROUTER_FIRSTMATE_HOME`, or else `FIRSTMATE_HOME`, the firstmate clone, `FM_HOME`, then `~/firstmate`. When that folder does not exist yet, the module skips this step rather than create it, so install Firstmate first. The resolver reads the key as `OPENROUTER_API_KEY` from the environment or that `.env`, not from this module's key file, so put the key there as well (the module lists it as a to-do when it finds none). An OpenRouter key alone never selects the provider. With no provider setting, the resolver keeps its original behavior: it uses `jev-latest` when `TYPESAFE_API_KEY` is available and is off otherwise. The environment wins over `.env` (Firstmate's `docs/configuration.md`, "Typed dispatch resolution"). |

This setup does not wrap or patch any tool to send its requests elsewhere. The Firstmate
resolver needs no wrapper or workaround, because its OpenRouter setting is built in, so the
module only writes those two documented settings. If
compact-adviser later documents an OpenRouter setting, it can be wired here the same way as
voice mode.
