/**
 * Valida se um CPF é matematicamente válido e não é uma sequência repetida de dígitos.
 */
export function validateCpf(cpf: string): boolean {
  // Remove caracteres não numéricos
  const cleanCpf = cpf.replace(/\D/g, '');

  // CPF deve ter exatamente 11 dígitos
  if (cleanCpf.length !== 11) {
    return false;
  }

  // Não pode ser uma sequência de dígitos repetidos (ex: 111.111.111-11)
  if (/^(\d)\1{10}$/.test(cleanCpf)) {
    return false;
  }

  // Validação do primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleanCpf.charAt(i)) * (10 - i);
  }
  let rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) {
    rest = 0;
  }
  if (rest !== parseInt(cleanCpf.charAt(9))) {
    return false;
  }

  // Validação do segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleanCpf.charAt(i)) * (11 - i);
  }
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) {
    rest = 0;
  }
  if (rest !== parseInt(cleanCpf.charAt(10))) {
    return false;
  }

  return true;
}
