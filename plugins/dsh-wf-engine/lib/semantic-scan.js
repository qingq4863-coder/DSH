import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import ts from 'typescript'

const supported = new Map([
  ['.js', ts.ScriptKind.JS], ['.jsx', ts.ScriptKind.JSX], ['.mjs', ts.ScriptKind.JS], ['.cjs', ts.ScriptKind.JS],
  ['.ts', ts.ScriptKind.TS], ['.tsx', ts.ScriptKind.TSX], ['.mts', ts.ScriptKind.TS], ['.cts', ts.ScriptKind.TS],
])
const hash = (value) => createHash('sha256').update(String(value ?? '')).digest('hex')
const text = (node, source) => node ? node.getText(source) : ''
const modifiers = (node) => new Set((node?.modifiers || []).map((item) => item.kind))
const exported = (node) => modifiers(node).has(ts.SyntaxKind.ExportKeyword) || modifiers(node?.parent).has(ts.SyntaxKind.ExportKeyword)
const canonical = (file) => resolve(file).replace(/\\/g, '/').toLowerCase()

function bindingNames(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name.text)
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const item of name.elements) if (ts.isBindingElement(item)) bindingNames(item.name, out)
  return out
}

function declarationName(node, source) {
  if (node.name) return text(node.name, source)
  if (ts.isExportAssignment(node)) return node.isExportEquals ? 'export=' : 'default'
  return ''
}

function astDependencies(node, source) {
  const found = new Set()
  const add = (target) => { const value = text(target, source); if (value) found.add(value) }
  const visit = (child) => {
    if (ts.isCallExpression(child) || ts.isNewExpression(child)) add(child.expression)
    else if (ts.isTypeReferenceNode(child)) add(child.typeName)
    else if (ts.isExpressionWithTypeArguments(child)) add(child.expression)
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return [...found].sort()
}

function checkerSignature(node, checker, source) {
  try {
    const signature = checker.getSignatureFromDeclaration(node)
    if (signature) return checker.signatureToString(signature, node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType)
    const symbol = node.name ? checker.getSymbolAtLocation(node.name) : checker.getSymbolAtLocation(node)
    if (symbol) {
      const type = checker.getTypeOfSymbolAtLocation(symbol, node)
      return checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType)
    }
  } catch { /* syntax-only fallback below */ }
  return text(node, source)
}

function nearestConfig(file) {
  return ts.findConfigFile(dirname(resolve(file)), existsSync, 'tsconfig.json')
}

function createProject(file, changedText, options = {}) {
  const cwd = resolve(options.currentDirectory || process.cwd())
  const changed = resolve(cwd, file)
  const virtualFiles = Object.entries(options.projectFiles || {}).map(([name, value]) => [resolve(cwd, name), String(value)])
  const virtual = new Map(virtualFiles.map(([name, value]) => [canonical(name), value]))
  virtual.set(canonical(changed), String(changedText ?? ''))
  const virtualNames = [...virtualFiles.map(([name]) => name), changed]
  let compilerOptions = { allowJs: true, checkJs: false, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
  let rootNames = virtualNames
  const configPath = options.tsconfig || (!options.projectFiles && nearestConfig(changed))
  if (configPath) {
    const loaded = ts.readConfigFile(configPath, (name) => readFileSync(name, 'utf8'))
    if (!loaded.error) {
      const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(configPath), {}, configPath)
      compilerOptions = { ...parsed.options, noEmit: true }
      rootNames = [...new Set([...parsed.fileNames, changed])]
    }
  }
  if (!rootNames.length) rootNames = [changed]
  const host = ts.createCompilerHost(compilerOptions, true)
  const originalRead = host.readFile.bind(host)
  const originalExists = host.fileExists.bind(host)
  const originalDirectoryExists = host.directoryExists?.bind(host)
  const virtualDirectories = new Set([...virtual.keys()].map((name) => canonical(dirname(name))))
  host.getCurrentDirectory = () => cwd
  host.directoryExists = (name) => virtualDirectories.has(canonical(name)) || Boolean(originalDirectoryExists?.(name))
  host.fileExists = (name) => virtual.has(canonical(name)) || originalExists(name)
  host.readFile = (name) => virtual.get(canonical(name)) ?? originalRead(name)
  host.getSourceFile = (name, languageVersion) => {
    const value = host.readFile(name)
    if (value === undefined) return undefined
    return ts.createSourceFile(name, value, languageVersion, true, supported.get(extname(name).toLowerCase()))
  }
  const program = ts.createProgram({ rootNames, options: compilerOptions, host })
  return { program, checker: program.getTypeChecker(), changed: canonical(changed), cwd }
}

function topLevelOwner(node, source) {
  let current = node
  while (current.parent && current.parent !== source) current = current.parent
  if (ts.isVariableStatement(current)) return current.declarationList.declarations[0]
  return current
}

function displayFile(source, cwd, requestedFile) {
  const requested = canonical(resolve(cwd, requestedFile))
  if (canonical(source.fileName) === requested) return requestedFile.replace(/\\/g, '/')
  return relative(cwd, source.fileName).replace(/\\/g, '/')
}

function parseProject(file, sourceText, options = {}) {
  const ext = extname(file).toLowerCase()
  if (!supported.has(ext)) return { supported: false, symbols: new Map(), edges: [], unknowns: [`unsupported semantic language: ${ext || '(none)'}`] }
  const project = createProject(file, sourceText, options)
  const source = project.program.getSourceFiles().find((item) => canonical(item.fileName) === project.changed)
  if (!source) return { supported: false, symbols: new Map(), edges: [], unknowns: [`program did not include changed file: ${file}`] }
  const unknowns = project.program.getSyntacticDiagnostics(source).map((item) => `parse error ${file}:${item.start ?? 0} ${ts.flattenDiagnosticMessageText(item.messageText, ' ')}`)
  for (const item of project.program.getSemanticDiagnostics().filter((diagnostic) => diagnostic.file && !diagnostic.file.isDeclarationFile)) {
    unknowns.push(`semantic error ${displayFile(item.file, project.cwd, file)}:${item.start ?? 0} ${ts.flattenDiagnosticMessageText(item.messageText, ' ')}`)
  }
  const symbols = new Map()
  const add = (name, node, isExported = exported(node)) => {
    if (!name) return
    const signature = checkerSignature(node, project.checker, source)
    symbols.set(name, { name, node, kind: ts.SyntaxKind[node.kind], exported: isExported, signature, signature_hash: hash(signature), body_hash: hash(text(node, source)), dependencies: astDependencies(node, source) })
  }
  for (const node of source.statements) {
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) for (const name of bindingNames(declaration.name)) add(name, declaration, exported(node))
    else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isExportAssignment(node)) add(declarationName(node, source), node)
  }
  const declarationToName = new Map()
  for (const symbol of symbols.values()) declarationToName.set(symbol.node, symbol.name)
  const edges = new Map()
  for (const candidate of project.program.getSourceFiles()) {
    if (candidate.isDeclarationFile) continue
    const visit = (node) => {
      if (ts.isIdentifier(node)) {
        let symbol = project.checker.getSymbolAtLocation(node)
        if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) {
          try { symbol = project.checker.getAliasedSymbol(symbol) } catch { /* unresolved alias */ }
        }
        for (const declaration of symbol?.declarations || []) {
          if (canonical(declaration.getSourceFile().fileName) !== project.changed) continue
          let target = declaration
          while (target.parent && target.parent !== source) target = target.parent
          if (ts.isVariableStatement(target)) target = target.declarationList.declarations.find((item) => item.name && text(item.name, source) === symbol.name) || target.declarationList.declarations[0]
          const targetName = declarationToName.get(target) || symbol.name
          const owner = topLevelOwner(node, candidate)
          const ownerName = declarationName(owner, candidate) || (ts.isVariableDeclaration(owner) ? text(owner.name, candidate) : '(module)')
          if (!targetName || (candidate === source && ownerName === targetName)) continue
          const from = `${displayFile(candidate, project.cwd, file)}#${ownerName}`
          const to = `${file.replace(/\\/g, '/')}#${targetName}`
          edges.set(`${from}->${to}`, { from, to, type: 'type-checker-reference', evidence: 'TypeScript Program + TypeChecker' })
        }
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(candidate, visit)
  }
  return { supported: true, symbols, edges: [...edges.values()], unknowns }
}

export function analyzeSemanticChange(file, beforeText, afterText, options = {}) {
  const before = parseProject(file, beforeText, options)
  const after = parseProject(file, afterText, options)
  const unknowns = [...new Set([...before.unknowns, ...after.unknowns])]
  if (!before.supported || !after.supported) return { supported: false, file, symbols: [], dependencies: [], contracts: [], unknowns }
  const names = new Set([...before.symbols.keys(), ...after.symbols.keys()])
  const symbols = []
  const contracts = []
  const edges = new Map()
  for (const name of names) {
    const oldSymbol = before.symbols.get(name)
    const newSymbol = after.symbols.get(name)
    let changeKind = ''
    if (!oldSymbol) changeKind = 'added'
    else if (!newSymbol) changeKind = 'removed'
    else if (oldSymbol.signature_hash !== newSymbol.signature_hash) changeKind = 'contract'
    else if (oldSymbol.body_hash !== newSymbol.body_hash) changeKind = 'behavior'
    if (!changeKind) continue
    const current = newSymbol || oldSymbol
    const target = `${file}#${name}`
    symbols.push({ file, symbol: name, target, exported: current.exported, change_kind: changeKind, evidence: `typescript-typechecker signature=${current.signature_hash} body=${current.body_hash}` })
    if ((oldSymbol?.exported || newSymbol?.exported) && ['added', 'removed', 'contract'].includes(changeKind)) contracts.push({ target, change: `exported ${current.kind} ${changeKind}`, evidence: `typescript-typechecker before=${oldSymbol?.signature_hash || 'none'} after=${newSymbol?.signature_hash || 'none'}` })
    for (const dependency of current.dependencies) edges.set(`${target}->${dependency}`, { from: target, to: dependency, type: 'ast-reference', evidence: 'TypeScript Compiler API' })
  }
  for (const edge of [...before.edges, ...after.edges]) edges.set(`${edge.from}->${edge.to}`, edge)
  return { supported: true, file, symbols, dependencies: [...edges.values()], contracts, unknowns }
}
