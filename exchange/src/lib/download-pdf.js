function sessionHeaders() {
  try {
    const session = JSON.parse(localStorage.getItem('pinit_exchange_session') || '{}');
    const headers = { Accept: 'application/pdf' };
    if (session.token) headers.Authorization = `Bearer ${session.token}`;
    if (session.pinit_id) headers['X-Pinit-Id'] = session.pinit_id;
    return headers;
  } catch {
    return { Accept: 'application/pdf' };
  }
}

export async function downloadPdf(path, filename) {
  const res = await fetch(path, { headers: sessionHeaders(), credentials: 'include' });
  if (!res.ok) throw new Error('The document could not be downloaded.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
