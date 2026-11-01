/** The four file tools. They answer from the access layer; proposals are only made, never applied. */
import { AccessDenied } from '../aiAccess'
import type { AiAccess } from '../aiAccess'
import { isPlainObject } from './adapter'
import type { ToolCall, ToolResult, ToolSpec } from './adapter'
import { ProposalError } from './proposals'
import type { EditSpec, ProposalStore } from './proposals'
import type { Proposal } from '../../shared/proposals'

const READ_CAP = 100_000
const SUGGESTED =
  'Suggested. The writer will see an Accept/Reject card; nothing changes until they accept.'
const FILE_ERROR = 'Something went wrong with that file.'

export const FILE_TOOLS: ToolSpec[] = [
  {
    name: 'list_files',
    description:
      'List the project files you can see, one per line, each marked "(can edit)" or "(read only)".',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'read_file',
    description: 'Read one project file. Use a path from list_files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative path, e.g. notes/ideas.md' }
      },
      required: ['path']
    }
  },
  {
    name: 'propose_edit',
    description:
      'Suggest changes to an existing file you can edit. The writer sees the change and accepts or rejects it; nothing is written until they accept. Each old_text must appear exactly once in the file, and edits must not overlap. Put all changes to one file in one call.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project-relative path of the file to change' },
        edits: {
          type: 'array',
          description: 'The replacements, applied together',
          items: {
            type: 'object',
            properties: {
              old_text: {
                type: 'string',
                description: 'Text to replace; must appear exactly once'
              },
              new_text: { type: 'string', description: 'The replacement text' }
            },
            required: ['old_text', 'new_text']
          }
        }
      },
      required: ['path', 'edits']
    }
  },
  {
    name: 'create_note',
    description:
      'Suggest a new markdown file in a folder you can edit. The writer accepts or rejects it. It never overwrites a file and does not make folders. ".md" is added to the path if missing.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Project-relative path of the new file, e.g. notes/plot'
        },
        content: { type: 'string', description: 'The text of the new file' }
      },
      required: ['path', 'content']
    }
  }
]

export interface ToolRunner {
  run(call: ToolCall): Promise<ToolResult>
}

/** Thrown for arguments of the wrong shape; the message goes back to the model. */
class BadArgs extends Error {}

function str(args: Record<string, unknown>, tool: string, field: string): string {
  const v = args[field]
  if (typeof v !== 'string') throw new BadArgs(`${tool} needs ${field}`)
  return v
}

function parseEdits(args: Record<string, unknown>): EditSpec[] {
  const v = args.edits
  const bad = new BadArgs('propose_edit needs edits: a list of { old_text, new_text }')
  if (!Array.isArray(v) || v.length === 0) throw bad
  return v.map((e: unknown) => {
    if (!isPlainObject(e) || typeof e.old_text !== 'string' || typeof e.new_text !== 'string') {
      throw bad
    }
    return { old_text: e.old_text, new_text: e.new_text }
  })
}

export function createToolRunner(deps: {
  root: string
  access: AiAccess
  proposals: ProposalStore
  onProposal(p: Proposal): void
}): ToolRunner {
  const { root, access, proposals, onProposal } = deps

  async function execute(call: ToolCall): Promise<string> {
    const { name, args } = call
    switch (name) {
      case 'list_files': {
        const files = await access.list()
        if (files.length === 0) return 'No files are visible to you.'
        return files
          .map((f) => `${f.relPath} (${f.access === 'edit' ? 'can edit' : 'read only'})`)
          .join('\n')
      }
      case 'read_file': {
        const { content } = await access.read(str(args, name, 'path'))
        return content.length > READ_CAP
          ? content.slice(0, READ_CAP) +
              `\n\n[Truncated: the file is longer than ${READ_CAP} characters.]`
          : content
      }
      case 'propose_edit': {
        const path = str(args, name, 'path')
        onProposal(await proposals.proposeEdit(root, access, path, parseEdits(args)))
        return SUGGESTED
      }
      case 'create_note': {
        let path = str(args, name, 'path')
        const content = str(args, name, 'content')
        if (!path.endsWith('.md')) path += '.md'
        onProposal(await proposals.proposeCreate(root, access, path, content))
        return SUGGESTED
      }
      default:
        throw new BadArgs(`Unknown tool: ${name}`)
    }
  }

  return {
    async run(call) {
      const result = (content: string, isError: boolean): ToolResult => ({
        callId: call.id,
        name: call.name,
        content: isError ? `Error: ${content}` : content,
        isError
      })
      try {
        return result(await execute(call), false)
      } catch (err) {
        if (err instanceof BadArgs || err instanceof AccessDenied || err instanceof ProposalError) {
          return result(err.message, true)
        }
        // Never log the error message: it may carry file content.
        console.error(`AI tool ${call.name} failed:`, err instanceof Error ? err.name : typeof err)
        return result(FILE_ERROR, true)
      }
    }
  }
}
