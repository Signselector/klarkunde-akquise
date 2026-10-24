// Local TypeScript check of the Deno entry point; the deployed runtime supplies Deno.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};
