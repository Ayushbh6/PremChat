"use client";

import { Menu } from "lucide-react";
import Image from "next/image";
import { AccessControls } from "@/components/chat/AccessControls";
import styles from "./socrates.module.css";

export function SocratesHeader({ onOpenGoals }: Readonly<{ onOpenGoals: () => void }>) {
  return (
    <header className={styles.socratesHeader}>
      <button type="button" className={styles.sidebarTrigger} onClick={onOpenGoals} aria-label="Open goals">
        <Menu aria-hidden="true" />
      </button>
      <div className={styles.wordmark} aria-label="Socrates">
        <Image src="/brand/socrates-logo.png" width={28} height={28} alt="" aria-hidden="true" priority />
        <span>Socrates</span>
      </div>
      <AccessControls variant="seamless" />
    </header>
  );
}
