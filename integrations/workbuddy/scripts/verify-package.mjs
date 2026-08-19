import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npmCli = process.env.npm_execpath

function run(args, cwd) {
  const result = spawnSync(npmCli ? process.execPath : npm, npmCli ? [npmCli, ...args] : args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32' && !npmCli,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

function runNode(script, input, cwd, env) {
  const result = spawnSync(process.execPath, [script], {
    cwd,
    env: { ...process.env, ...env },
    input: `${JSON.stringify(input)}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.status !== 0) throw new Error(`node ${script} failed\n${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  const line = result.stdout.trim().split(/\r?\n/u).at(-1)
  return JSON.parse(line)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function mcpSmoke(serverPath, cwd, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [serverPath], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let completed = false
    const timer = setTimeout(() => finish(new Error(`MCP handshake timed out\n${stderr}`)), 15_000)

    function finish(error) {
      clearTimeout(timer)
      child.kill()
      if (error) rejectPromise(error)
      else resolvePromise()
    }

    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', finish)
    child.on('exit', (code) => {
      if (!completed) finish(new Error(`MCP server exited before resource verification (code ${code})\n${stderr}`))
    })
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      let newline
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline).trim()
        stdout = stdout.slice(newline + 1)
        if (!line) continue
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
        }
        if (message.id === 2) {
          const tools = message.result?.tools ?? []
          const names = new Set(tools.map((tool) => tool.name))
          for (const required of ['memory_search_events', 'memory_assess', 'memory_record_use', 'memory_status']) {
            assert(names.has(required), `MCP tools/list is missing ${required}`)
          }
          const recordUse = tools.find((tool) => tool.name === 'memory_record_use')
          assert(recordUse?._meta?.ui?.resourceUri === 'ui://stratagate/star-prompt-v1', 'memory_record_use is missing its MCP App resource')
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} })}\n`)
        }
        if (message.id === 3) {
          const resource = (message.result?.resources ?? []).find(({ uri }) => uri === 'ui://stratagate/star-prompt-v1')
          assert(resource?.mimeType === 'text/html;profile=mcp-app', 'MCP resources/list is missing the Star widget')
          child.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            method: 'resources/read',
            params: { uri: 'ui://stratagate/star-prompt-v1' },
          })}\n`)
        }
        if (message.id === 4) {
          const content = message.result?.contents?.[0]
          assert(content?.mimeType === 'text/html;profile=mcp-app', 'Star widget resource has the wrong MIME type')
          assert(content?.text?.includes('给 StrataGate 点 Star'), 'Star widget HTML is missing its call to action')
          assert(content?.text?.includes('ui/open-link'), 'Star widget is missing the MCP open-link bridge')
          assert(!content?.text?.includes('esm.sh'), 'Star widget unexpectedly depends on a remote CDN')
          completed = true
          finish()
        }
      }
    })
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'stratagate-package-verifier', version: '1.0.0' },
      },
    })}\n`)
  })
}

let tarball
let installRoot
try {
  const packOutput = run(['pack', '--json', '--ignore-scripts'], packageRoot)
  const jsonStart = Math.max(packOutput.lastIndexOf('\n['), packOutput.startsWith('[') ? 0 : -1)
  assert(jsonStart >= 0, `npm pack did not return JSON:\n${packOutput}`)
  const packed = JSON.parse(packOutput.slice(jsonStart).trim())[0]
  tarball = join(packageRoot, packed.filename)
  const files = new Set(packed.files.map(({ path }) => path.replaceAll('\\', '/')))
  const required = [
    'package.json',
    '.codebuddy-plugin/plugin.json',
    '.mcp.json',
    'hooks/hooks.json',
    'skills/memory/SKILL.md',
    'README.md',
    'README.zh-CN.md',
    'CHANGELOG.md',
    'LICENSE',
    'dist/server.cjs',
    'dist/hook.cjs',
    'dist/star-widget-client.global.js',
  ]
  for (const path of required) assert(files.has(path), `Packed artifact is missing ${path}`)
  for (const path of files) {
    assert(!/^(src|tests|scripts)\//u.test(path), `Development file leaked into package: ${path}`)
    assert(!/\.(?:db|sqlite3?|pem|key)$/iu.test(path), `Sensitive/runtime file leaked into package: ${path}`)
  }

  const manifest = JSON.parse(readFileSync(join(packageRoot, '.codebuddy-plugin', 'plugin.json'), 'utf8'))
  assert(manifest.name === 'stratagate-memory', 'Plugin manifest has the wrong name')
  assert(manifest.hooks === './hooks/hooks.json', 'Plugin manifest does not register hooks')
  assert(manifest.mcpServers === './.mcp.json', 'Plugin manifest does not register MCP')

  installRoot = mkdtempSync(join(tmpdir(), 'stratagate-workbuddy-pack-'))
  run(['init', '--yes'], installRoot)
  run(['install', tarball, '--package-lock=false'], installRoot)
  const installed = join(installRoot, 'node_modules', 'stratagate-workbuddy')
  for (const path of required) assert(existsSync(join(installed, path)), `Clean install is missing ${path}`)

  const dataDir = join(installRoot, 'plugin-data')
  const projectDir = join(installRoot, 'sample-project')
  const transcript = join(installRoot, 'transcript.jsonl')
  mkdirSync(projectDir, { recursive: true })
  const env = {
    STRATAGATE_DATA_DIR: dataDir,
    STRATAGATE_PROJECT_DIR: projectDir,
    STRATAGATE_BLOCK_TURN_SIZE: '1',
    STRATAGATE_DISABLE_WORKBUDDY_MODEL: '1',
  }
  const hook = join(installed, 'dist', 'hook.cjs')
  const submitted = runNode(hook, {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'verify-session',
    transcript_path: transcript,
    cwd: projectDir,
    prompt: 'Remember the deployment target.',
  }, projectDir, env)
  assert(submitted.continue === true, 'UserPromptSubmit hook did not fail open')

  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', timestamp: '2026-08-19T00:00:00.000Z', message: { content: [{ type: 'text', text: 'Remember the deployment target.' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-08-19T00:00:01.000Z', message: { content: [{ type: 'text', text: 'The deployment target is Singapore.' }] } }),
    '',
  ].join('\n'))
  const stopped = runNode(hook, {
    hook_event_name: 'Stop',
    session_id: 'verify-session',
    transcript_path: transcript,
    cwd: projectDir,
  }, projectDir, env)
  assert(stopped.continue === true, 'Stop hook did not fail open')
  assert(existsSync(join(dataDir, 'memory.db')), 'Stop hook did not create the local memory database')

  await mcpSmoke(join(installed, 'dist', 'server.cjs'), projectDir, env)
  console.log(`Verified ${packed.filename}: ${packed.entryCount} files, clean install, hooks, and MCP handshake passed.`)
} finally {
  if (installRoot) rmSync(installRoot, { recursive: true, force: true })
  if (tarball) rmSync(tarball, { force: true })
}
