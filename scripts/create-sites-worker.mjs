import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('dist/server', { recursive: true })

writeFileSync(
  'dist/server/index.js',
  `export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (!url.pathname.includes('.') && !url.pathname.endsWith('/')) {
      url.pathname = '/'
    }

    return env.ASSETS.fetch(new Request(url, request))
  },
}
`,
)
