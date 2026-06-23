import { useState } from 'react'
import { useMxTerminal } from '@/hooks/useMxTerminal'

interface Props {
  sessionId: string | null
}

export function MxTerminal({ sessionId }: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useMxTerminal(sessionId, container)
  return <div ref={setContainer} className="h-full w-full overflow-hidden bg-bg p-1" />
}
