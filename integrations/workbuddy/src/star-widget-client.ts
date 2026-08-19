import { App } from '@modelcontextprotocol/ext-apps/app-with-deps'

const DEFAULT_REPOSITORY_URL = 'https://github.com/diqierjia/StrataGate-AgentMemory'

const app = new App(
  { name: 'stratagate-star-prompt', version: '1.0.0' },
  {},
  { autoResize: true },
)
const card = document.getElementById('card') as HTMLElement
const title = document.getElementById('title') as HTMLElement
const star = document.getElementById('star') as HTMLButtonElement
const dismiss = document.getElementById('dismiss') as HTMLButtonElement
let repositoryUrl = DEFAULT_REPOSITORY_URL

function close(): void {
  card.hidden = true
  void Promise.resolve(app.requestTeardown()).catch(() => {})
}

function applyTheme(theme: string | undefined): void {
  if (theme !== 'light' && theme !== 'dark') return
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

app.ontoolresult = (result) => {
  const structured = result.structuredContent as { starPrompt?: { repositoryUrl?: unknown, usageRecords?: unknown } } | undefined
  const prompt = structured?.starPrompt
  if (!prompt) return close()
  repositoryUrl = typeof prompt.repositoryUrl === 'string' ? prompt.repositoryUrl : DEFAULT_REPOSITORY_URL
  const usageRecords = typeof prompt.usageRecords === 'number' ? prompt.usageRecords : 0
  title.textContent = `StrataGate 已帮助当前项目完成 ${usageRecords} 次有证据支持的记忆召回。`
  card.hidden = false
}
app.onhostcontextchanged = (context) => applyTheme(context.theme)

star.addEventListener('click', async () => {
  try {
    await app.openLink({ url: repositoryUrl })
  } finally {
    close()
  }
})
dismiss.addEventListener('click', close)

async function main(): Promise<void> {
  await app.connect()
  applyTheme(app.getHostContext()?.theme)
}

void main()
