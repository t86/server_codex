import { NextRequest, NextResponse } from "next/server";

const user = process.env.WEB_BASIC_AUTH_USER;
const password = process.env.WEB_BASIC_AUTH_PASSWORD;

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Server Codex", charset="UTF-8"'
    }
  });
}

export function middleware(request: NextRequest) {
  if (!user || !password) {
    return NextResponse.next();
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return unauthorized();
  }

  const decoded = atob(header.slice("Basic ".length));
  const separator = decoded.indexOf(":");
  const givenUser = separator >= 0 ? decoded.slice(0, separator) : "";
  const givenPassword = separator >= 0 ? decoded.slice(separator + 1) : "";

  if (givenUser !== user || givenPassword !== password) {
    return unauthorized();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
