export class Logger {
  log(message: string): void {
    console.log(message);
  }
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

export const CONFIG = {
  apiUrl: 'https://api.example.com',
  timeout: 5000,
};
