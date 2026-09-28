import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root || JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version !== "2.4.0") {
  throw new Error("These compatibility patches require Homepage 2.4.0; review before upgrading.");
}

function replace(file, before, after) {
  const target = path.join(root, file);
  const source = fs.readFileSync(target, "utf8");
  if (source.split(before).length !== 2) throw new Error(`Expected one patch target in ${file}`);
  fs.writeFileSync(target, source.replace(before, after));
}

const auth = "src/pages/api/auth/[...nextauth].js";
replace(auth, 'const homepageAuthPassword = process.env.HOMEPAGE_AUTH_PASSWORD;', `const homepageAuthPassword = process.env.HOMEPAGE_AUTH_PASSWORD;
const credentialsUrl = process.env.HOMEPAGE_CREDENTIALS_URL;
const credentialsSecret = process.env.HOMEPAGE_CREDENTIALS_SECRET;`);
replace(auth, '} else if (!homepageAuthPassword || !process.env.NEXTAUTH_SECRET) {', `} else if (credentialsUrl) {
    const url = new URL(credentialsUrl);
    if (!["http:", "https:"].includes(url.protocol) || !credentialsSecret || !process.env.NEXTAUTH_SECRET) {
      throw new Error("Multi-user auth requires an internal HTTP(S) verifier and both secrets.");
    }
  } else if (!homepageAuthPassword || !process.env.NEXTAUTH_SECRET) {`);
replace(auth, 'credentials: {\n          password:', 'credentials: {\n          ...(credentialsUrl ? { username: { label: "Username", type: "text" } } : {}),\n          password:');
replace(auth, '        async authorize(credentials) {\n          const provided', `        async authorize(credentials) {
          if (credentialsUrl) {
            const username = typeof credentials?.username === "string" ? credentials.username.trim() : null;
            if (typeof username !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(username) ||
                typeof credentials?.password !== "string" || credentials.password.length > 128) {
              logFailedPasswordSignIn();
              return null;
            }
            try {
              const response = await fetch(credentialsUrl, {
                method: "POST",
                redirect: "error",
                headers: { "Content-Type": "application/json", Authorization: \`Bearer \${credentialsSecret}\` },
                body: JSON.stringify({ username, password: credentials.password }),
                signal: AbortSignal.timeout(5000),
              });
              const user = response.ok ? await response.json() : null;
              if (user?.id === username && user?.name === username && typeof user.credentialVersion === "string") {
                return user;
              }
            } catch {
              createLogger("nextauth").error("Account verifier unavailable");
            }
            logFailedPasswordSignIn();
            return null;
          }
          const provided`);
replace(auth, '  secret: process.env.NEXTAUTH_SECRET,', `  callbacks: {
    async jwt({ token, user }) {
      if (user?.credentialVersion) token.credentialVersion = user.credentialVersion;
      return token;
    },
    async session({ session, token }) {
      if (credentialsUrl && session.user) session.user.credentialVersion = token.credentialVersion;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,`);

const signin = "src/pages/auth/signin.jsx";
replace(signin, 'SignIn({ providers, settings, autoLogin })', 'SignIn({ providers, settings, autoLogin, multiUser = false })');
replace(signin, '  const [password, setPassword] = useState("");', '  const [password, setPassword] = useState("");\n  const [username, setUsername] = useState("");');
replace(signin, '                          password,', '                          password,\n                          ...(multiUser ? { username } : {}),');
replace(signin, '                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Password</label>', `                      {multiUser && (
                        <>
                          <label htmlFor="username" className="block text-sm font-medium text-gray-700 dark:text-slate-300">Username</label>
                          <input
                            id="username"
                            type="text"
                            name="username"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            autoComplete="username"
                            maxLength={64}
                            className="w-full rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-gray-900 shadow-sm outline-none ring-0 transition focus:border-theme-500 focus:ring-2 focus:ring-theme-500/30 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
                            required
                          />
                        </>
                      )}
                      <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-slate-300">Password</label>`);
replace(signin, '                        type="password"', '                        id="password"\n                        type="password"');
replace(signin, '                    Invalid password. Please try again.', '                    {multiUser ? "Invalid username or password. Please try again." : "Invalid password. Please try again."}');
replace(signin, 'props: { providers, settings, autoLogin: process.env.HOMEPAGE_OIDC_AUTO_LOGIN === "true" }', 'props: { providers, settings, autoLogin: process.env.HOMEPAGE_OIDC_AUTO_LOGIN === "true", ...(process.env.HOMEPAGE_CREDENTIALS_URL ? { multiUser: true } : {}) }');

// Read mounted settings on each dashboard request, without mutating Next build output.
replace("src/pages/index.jsx", "export async function getStaticProps()", "export async function getServerSideProps()");
replace("src/pages/api/revalidate.js", '    await res.revalidate("/");', '    // SSR loads mounted configuration on every request; a browser reload is sufficient.');

// Forward identities only to our internal calendar proxy, never to external iCal URLs.
replace("src/widgets/calendar/proxy.js", '      const [status, contentType, data] = await httpProxy(integration.url, options);', `      const user = req.headers?.["x-authenticated-user"];
      if (new URL(integration.url).origin === process.env.HOMEPAGE_CALENDAR_ORIGIN) {
        if (typeof user !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(user)) {
          return res.status(401).json({ error: "Calendar identity required" });
        }
        options.headers = { ...options.headers, "X-Authenticated-User": user };
      }
      const [status, contentType, data] = await httpProxy(integration.url, options);`);

// The native login page must be able to load the configured local wallpaper.
replace("src/middleware.js", 'pathname === "/api/config/custom.css";', 'pathname === "/api/config/custom.css" || pathname.startsWith("/images/") || pathname === "/webhead.ico";');
console.log("Applied Homepage 2.4.0 multi-user, calendar, SSR and login asset compatibility patches.");
