export function JsonViewer({ data }: { data: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-700">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}
