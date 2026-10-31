import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LoginDto } from './login.dto.js';

describe('login DTO', () => {
  const parse = (body: object) => {
    const dto = plainToInstance(LoginDto, body);
    return { dto, errors: validateSync(dto) };
  };

  it('lowercases and trims the email and organisation slug', () => {
    const { dto, errors } = parse({ orgSlug: ' Demo ', email: '  Ann@Example.COM ', password: 'x' });
    expect(errors).toHaveLength(0);
    expect(dto.email).toBe('ann@example.com');
    expect(dto.orgSlug).toBe('demo');
  });

  it('defaults organisation slug to shagun when omitted', () => {
    const { dto, errors } = parse({ email: 'priya@example.com', password: 'Password123!' });
    expect(errors).toHaveLength(0);
    expect(dto.email).toBe('priya@example.com');
    expect(dto.orgSlug).toBe('shagun');
  });

  it('refuses an absurdly long password before bcrypt sees it', () => {
    expect(parse({ orgSlug: 'demo', email: 'a@b.co', password: 'x'.repeat(201) }).errors).not.toHaveLength(0);
  });
});
