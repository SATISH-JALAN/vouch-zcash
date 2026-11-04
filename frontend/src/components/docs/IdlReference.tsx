// A Solana program's reference, rendered from its Anchor IDL at build time: instructions with their
// accounts and arguments, account layouts, events and errors. The IDL is the one the site's
// instruction builders use, so this page cannot drift from the deployed programs.
import { C, H3, Table } from './content'

type IdlType = string | { vec?: IdlType; array?: [IdlType, number]; option?: IdlType; defined?: { name: string } }
interface IdlSeed {
  kind: 'const' | 'arg' | 'account'
  value?: number[]
  path?: string
}
interface IdlAccountItem {
  name: string
  writable?: boolean
  signer?: boolean
  docs?: string[]
  address?: string
  pda?: { seeds: IdlSeed[]; program?: unknown }
}
interface IdlField {
  name: string
  type: IdlType
  docs?: string[]
}
export interface Idl {
  address: string
  metadata?: { name?: string; version?: string }
  instructions: { name: string; docs?: string[]; accounts: IdlAccountItem[]; args: IdlField[] }[]
  accounts?: { name: string }[]
  events?: { name: string }[]
  errors?: { code: number; name: string; msg?: string }[]
  types?: { name: string; docs?: string[]; type: { kind: string; fields?: IdlField[] } }[]
}

export function typeName(t: IdlType): string {
  if (typeof t === 'string') return t
  if (t.vec) return `Vec<${typeName(t.vec)}>`
  if (t.array) return `[${typeName(t.array[0])}; ${t.array[1]}]`
  if (t.option) return `Option<${typeName(t.option)}>`
  if (t.defined) return t.defined.name
  return 'unknown'
}

function seeds(s: IdlSeed[]) {
  return `[${s
    .map((x) => (x.kind === 'const' && x.value ? `"${String.fromCharCode(...x.value)}"` : x.path ?? x.kind))
    .join(', ')}]`
}

const flags = (a: IdlAccountItem) => [a.writable && 'writable', a.signer && 'signer', a.pda && 'PDA', a.address && 'fixed'].filter(Boolean).join(' · ')

export function IdlReference({ idl, name }: { idl: Idl; name: string }) {
  const typeOf = (n: string) => idl.types?.find((t) => t.name === n)
  return (
    <>
      <p>
        Program id <C>{idl.address}</C> on devnet. {idl.instructions.length} instructions, {idl.accounts?.length ?? 0} account types,{' '}
        {idl.errors?.length ?? 0} errors.
      </p>
      <H3>Instructions</H3>
      {idl.instructions.map((ix) => (
        <div key={ix.name} className="dx-idl-ix">
          <p className="dx-idl-name">
            <C>{`${name}::${ix.name}(${ix.args.map((a) => `${a.name}: ${typeName(a.type)}`).join(', ')})`}</C>
          </p>
          {ix.docs?.length ? <p>{ix.docs.join(' ')}</p> : null}
          <Table
            head={['Account', 'Flags', 'Seeds / notes']}
            rows={ix.accounts.map((a) => [<C key="n">{a.name}</C>, flags(a) || '—', a.pda ? <C key="s">{seeds(a.pda.seeds)}</C> : (a.docs?.join(' ') ?? a.address ?? '')])}
          />
        </div>
      ))}
      {idl.accounts?.length ? (
        <>
          <H3>Accounts</H3>
          {idl.accounts.map((acc) => {
            const t = typeOf(acc.name)
            return (
              <div key={acc.name}>
                <p className="dx-idl-name">
                  <C>{acc.name}</C>
                </p>
                {t?.type.fields && <Table head={['Field', 'Type', 'Notes']} rows={t.type.fields.map((f) => [<C key="f">{f.name}</C>, <C key="t">{typeName(f.type)}</C>, f.docs?.join(' ') ?? ''])} />}
              </div>
            )
          })}
        </>
      ) : null}
      {idl.events?.length ? (
        <>
          <H3>Events</H3>
          <Table
            head={['Event', 'Fields']}
            rows={idl.events.map((e) => [<C key="e">{e.name}</C>, (typeOf(e.name)?.type.fields ?? []).map((f) => f.name).join(', ')])}
          />
        </>
      ) : null}
      {idl.errors?.length ? (
        <>
          <H3>Errors</H3>
          <Table head={['Code', 'Name', 'Message']} rows={idl.errors.map((e) => [String(e.code), <C key="n">{e.name}</C>, e.msg ?? ''])} />
        </>
      ) : null}
    </>
  )
}
