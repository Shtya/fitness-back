// src/money/dto/money.dto.ts

export class CreateWalletAccountDto {
  name!: any;
  currency?: any;
  openingBalance?: any;
  isDefault?: any;
  notes?: any;
}

export class UpdateWalletAccountDto {
  name?: any;
  currency?: any;
  openingBalance?: any;
  isDefault?: any;
  notes?: any;
}

export class CreateIncomeEntryDto {
  accountId?: any;
  source!: any;
  notes?: any;
  amount!: any;
  date!: any;
  recurring?: any;
  recurrenceType?: any;
  recurrenceEvery?: any;
}

export class UpdateIncomeEntryDto {
  accountId?: any;
  source?: any;
  notes?: any;
  amount?: any;
  date?: any;
  recurring?: any;
  recurrenceType?: any;
  recurrenceEvery?: any;
  isActive?: any;
}

export class CreateExpenseEntryDto {
  accountId?: any;
  description!: any;
  category?: any;
  notes?: any;
  amount!: any;
  date!: any;
  recurring?: any;
  recurrenceType?: any;
  recurrenceEvery?: any;
}

export class UpdateExpenseEntryDto {
  accountId?: any;
  description?: any;
  category?: any;
  notes?: any;
  amount?: any;
  date?: any;
  recurring?: any;
  recurrenceType?: any;
  recurrenceEvery?: any;
  isActive?: any;
}

export class CreateFinancialCommitmentDto {
  accountId?: any;
  name!: any;
  type?: any;
  amount!: any;
  dueDate!: any;
  status?: any;
  recurring?: any;
  recurrenceType?: any;
  recurrenceEvery?: any;
  jamiaStart?: any;
  jamiaEnd?: any;
  jamiaMyMonth?: any;
  notes?: any;
}

export class UpdateFinancialCommitmentDto {
  accountId?: any;
  name?: any;
  type?: any;
  amount?: any;
  dueDate?: any;
  status?: any;
  recurring?: any;
  recurrenceType?: any;
  recurrenceEvery?: any;
  jamiaStart?: any;
  jamiaEnd?: any;
  jamiaMyMonth?: any;
  notes?: any;
}

export class CreateZakatLogDto {
  accountId?: any;
  description!: any;
  amount!: any;
  date!: any;
  isZakat?: any;
  notes?: any;
}

export class UpdateZakatLogDto {
  accountId?: any;
  description?: any;
  amount?: any;
  date?: any;
  isZakat?: any;
  notes?: any;
}

export class CreateFinanceNotificationDto {
  type?: any;
  text!: any;
  timeLabel?: any;
  isRead?: any;
  meta?: any;
}

export class UpdateFinanceNotificationDto {
  type?: any;
  text?: any;
  timeLabel?: any;
  isRead?: any;
  meta?: any;
}



export class CreateExpectedEntryDto {
  accountId?: any;
  description!: any;
  amount!: any;
  expectedDate!: any;
  notes?: any;
}

export class UpdateExpectedEntryDto {
  accountId?: any;
  description?: any;
  amount?: any;
  expectedDate?: any;
  notes?: any;
}