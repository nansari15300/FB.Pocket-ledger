"use client";

import { useEffect, useRef } from "react";

function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

type AliasNameForm = {
  watch: (name: "name") => unknown;
  getValues: (name: "aliasName") => unknown;
  setValue: (
    name: "aliasName",
    value: string,
    opts?: { shouldDirty?: boolean; shouldValidate?: boolean }
  ) => void;
};

/**
 * Party create/edit: copy Party Name into Alias until the user edits Alias.
 * Do not copy when the name is an email address.
 */
export function useAutoAliasFromName(form: AliasNameForm) {
  const name = form.watch("name");
  const aliasLockedRef = useRef(false);

  useEffect(() => {
    if (aliasLockedRef.current) return;
    const n = String(name ?? "");
    const a = String(form.getValues("aliasName") ?? "");
    if (a.trim() && a.trim() !== n.trim()) {
      aliasLockedRef.current = true;
      return;
    }
    if (looksLikeEmail(n.trim())) {
      if (a) form.setValue("aliasName", "", { shouldDirty: false, shouldValidate: false });
      return;
    }
    if (a !== n) {
      form.setValue("aliasName", n, { shouldDirty: false, shouldValidate: false });
    }
  }, [name, form]);

  return {
    markAliasUserEdited: () => {
      aliasLockedRef.current = true;
    },
  };
}
