function esc(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function loading(title: string, msg: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(title)}</title>
    <style>
      html, body {
        height: 100%;
        width: 100%;
        margin: 0;
        background: #1e1e1e;
        color: #ccc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      main {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }
      .spin {
        width: 16px;
        height: 16px;
        border: 2px solid #333;
        border-top: 2px solid #007acc;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="spin"></div>
      <div>${esc(title)}</div>
      <div>${esc(msg)}</div>
    </main>
  </body>
</html>`
}
