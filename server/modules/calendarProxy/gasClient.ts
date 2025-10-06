export async function callGAS(webAppUrl: string, payload: any): Promise<any> {
  const response = await fetch(webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GAS call failed (${response.status}): ${text}`);
  }

  return response.json();
}
