import { toArray } from '@unocss/core'
import type { SourceCodeTransformer } from '@unocss/core'
import swc from '@swc/core'
import { walkASTSetup } from 'ast-kit'

export type FilterPattern = Array<string | RegExp> | string | RegExp | null

function createFilter(
  include: FilterPattern,
  exclude: FilterPattern,
): (id: string) => boolean {
  const includePattern = toArray(include || [])
  const excludePattern = toArray(exclude || [])
  return (id: string) => {
    if (excludePattern.some(p => id.match(p)))
      return false
    return includePattern.some(p => id.match(p))
  }
}

export interface TransformerAttributifyJsxOptions {
  /**
   * the list of attributes to ignore
   * @default []
   */
  blocklist?: (string | RegExp)[]

  /**
   * Regex of modules to be included from processing
   * @default [/\.[jt]sx$/, /\.mdx$/]
   */
  include?: FilterPattern

  /**
   * Regex of modules to exclude from processing
   *
   * @default []
   */
  exclude?: FilterPattern
}

export default function transformerAttributifyJsxSwc(
  options: TransformerAttributifyJsxOptions = {},
): SourceCodeTransformer {
  const { blocklist = [] } = options

  const isBlocked = (matchedRule: string) => {
    for (const blockedRule of blocklist) {
      if (blockedRule instanceof RegExp) {
        if (blockedRule.test(matchedRule))
          return true
      }
      else if (matchedRule === blockedRule) {
        return true
      }
    }

    return false
  }

  const idFilter = createFilter(
    options.include || [/\.[jt]sx$/, /\.mdx$/],
    options.exclude || [],
  )

  return {
    name: '@unocss/transformer-attributify-jsx-swc',
    enforce: 'pre',
    idFilter,
    async transform(code, _, { uno }) {
      const tasks: Promise<void>[] = []

      const ast = await swc.parse(code.original, {
        syntax: 'typescript',
        comments: false,
        script: true,
        tsx: true,
        target: 'esnext',
      })
      const offset = ast.span.start
      const nodes: any[] = []
      await walkASTSetup(ast.body as any, ({ onEnter }) => {
        onEnter((node) => {
          return node.type === 'JSXAttribute' || node.type === 'JSXNamespacedName'
        }, (node) => {
          nodes.push(node)
        })
      })

      for (const node of nodes) {
        if (node.name.type !== 'Identifier')
          continue
        const matchedRule = node.name.value.replace(/:/i, '-')
        if (isBlocked(matchedRule))
          continue

        tasks.push(
          uno.parseToken(matchedRule).then((matched) => {
            if (matched) {
              code.overwrite(
                node.name.span.start - offset,
                node.name.span.end - offset,
                `${matchedRule}=""`,
              )
            }
          }),
        )
      }

      await Promise.all(tasks)
    },
  }
}
