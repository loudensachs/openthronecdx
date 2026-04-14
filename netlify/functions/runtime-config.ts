export default async () => {
  return new Response(
    JSON.stringify({
      partykitHost: process.env.PARTYKIT_HOST ?? ""
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      }
    }
  );
};
