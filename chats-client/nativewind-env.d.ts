/// <reference types="nativewind/types" />
import "nativewind/types";

declare module "nativewind/types" {
  interface CustomColors {
    primary: string;
    "primary-soft": string;
    background: string;
    "background-alt": string;
    surface: string;
    "surface-elevated": string;
    border: string;
    text: string;
    muted: string;
    success: string;
    warning: string;
    danger: string;
  }
}