import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LivingSphere } from "@/components/socrates/LivingSphere";
import styles from "./welcome.module.css";

export default function WelcomePage() {
  return (
    <main className={styles.welcomePage}>
      <div className={styles.oceanNoise} aria-hidden="true" />
      <div className={styles.welcomeOrb}>
        <LivingSphere state="idle" size="compact" statusLabel="Socrates is ready" showStatus={false} />
      </div>
      <section className={styles.welcomeContent} aria-labelledby="welcome-title">
        <h1 id="welcome-title">Welcome to Socrates</h1>
        <Link href="/chat" className={styles.welcomeOpenAction}>
          Open Socrates
          <ArrowRight aria-hidden="true" />
        </Link>
      </section>
    </main>
  );
}
