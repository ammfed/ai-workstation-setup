# MarkItDown offline rules

The `extras` module installs `markitdown[docx,pptx,xlsx]==0.1.9` as an isolated tool
(`uv tool install`, or `pipx install`). The built-in Word, PowerPoint and Excel converters run
fully offline. Keep them that way:

- Never pass an endpoint (`-d`, `docintel_endpoint`, `cu_endpoint`), an LLM client or an LLM model. Those send the file to an outside service.
- Never install the `pdf`, `audio-transcription`, `az-doc-intel` or `az-content-understanding` extras, the `markitdown-ocr` plugin or the `markitdown-mcp` server. Never pass `--use-plugins`.
- Never hand it a URL. In code, call `convert_local(path)` or `convert_stream(stream, stream_info=...)`. Do not call `convert(text)` on a string that came from a user or a file: a string that starts with `http`, `https`, `file` or `data` is fetched.
- The `markitdown` command loads a small local file-type model (Magika). It runs on this machine and sends nothing out.
- Use `pdftotext` for PDFs. MarkItDown reverses Arabic text in PDFs and does not read scans.
