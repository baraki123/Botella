# Playwright MCP setup

`@playwright/mcp` is installed globally. To wire it into Claude Code so I can
drive the browser via MCP tools (instead of the Python script), add this to
your Claude Code MCP config and restart Claude Code.

## The config to add

Open `~/.claude/.mcp.json` (create it if missing) and add:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "playwright-mcp",
      "args": []
    }
  }
}
```

If the file already has `mcpServers`, just merge the `playwright` entry.

## After restart

You'll see new tools available named `mcp__playwright__*` — `browser_navigate`,
`browser_click`, `browser_type`, `browser_snapshot`, etc. I'll be able to:

- Open the chat at `http://localhost:8081`
- Take live screenshots of any state
- Click chips, type into the composer, read bubble text
- Watch browser console + network in real time

## In the meantime — what I have right now (no restart)

I installed `playwright` in the Python venv and wrote `scripts/monitor.py`
which gives the **same capability** without needing the MCP restart:

```bash
source venv/bin/activate

# Walk the canned conversation, save screenshots to /tmp/botella-shots/
python scripts/monitor.py

# Open the browser visibly and leave it for you to play with
python scripts/monitor.py --interactive

# One screenshot of the current state
python scripts/monitor.py --shot only

# Open with a visible window (for me to watch via screenshots)
python scripts/monitor.py --headed
```

When the MCP server is configured and you've restarted, the MCP tools are
nicer (no need to write a Python script per scenario), but the underlying
capability is identical — both use Playwright + Chromium.
