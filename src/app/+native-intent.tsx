/**
 * Home Assistant's login redirects to miscale://auth. expo-web-browser picks that URL up for
 * the login itself; without this, Expo Router would also open it as an unknown screen.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    if (/^(miscale:\/\/)?\/?auth\b/.test(path)) return "/settings";
    return path;
  } catch {
    return "/";
  }
}
