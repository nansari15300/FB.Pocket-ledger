import { AdminLayoutClient } from "./AdminLayoutClient";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
