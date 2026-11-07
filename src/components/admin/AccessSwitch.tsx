"use client";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface AccessSwitchProps {
  label: string;
  isChecked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function AccessSwitch({ label, isChecked, onCheckedChange, disabled }: AccessSwitchProps) {
  const id = `access-switch-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id={id}
        checked={isChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
