import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Ajv, type ValidateFunction } from 'ajv';
import { Repository } from 'typeorm';
import { DeviceType, type JsonSchema } from './device-type.entity.js';

@Injectable()
export class DeviceTypesService {
  private readonly ajv = new Ajv({ allErrors: true, strict: true });
  /** Compiled validators, keyed by schema object. Types change via migrations, so no expiry. */
  private readonly compiled = new WeakMap<JsonSchema, ValidateFunction>();
  private readonly types = new Map<string, DeviceType>();

  constructor(
    @InjectRepository(DeviceType)
    private readonly repo: Repository<DeviceType>,
  ) {}

  list(): Promise<DeviceType[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async get(key: string): Promise<DeviceType> {
    let type = this.types.get(key);
    if (!type) {
      type = (await this.repo.findOneBy({ key })) ?? undefined;
      if (!type) {
        throw new NotFoundException(`Unknown device type ${key}`);
      }
      this.types.set(key, type);
    }
    return type;
  }

  /** Throws 422 unless `state` matches the type's stateSchema. */
  async validateState(typeKey: string, state: unknown): Promise<void> {
    const type = await this.get(typeKey);
    this.validate(type.stateSchema, state, 'Invalid state');
  }

  /** Throws 422 unless `action` exists for the type and `payload` matches its schema. */
  async validateCommand(
    typeKey: string,
    action: string,
    payload: unknown,
  ): Promise<void> {
    const type = await this.get(typeKey);
    const schema = Object.hasOwn(type.commands, action)
      ? type.commands[action]
      : undefined;
    if (!schema) {
      throw new UnprocessableEntityException({
        message: `"${action}" is not a command for ${type.key} devices`,
        allowed: Object.keys(type.commands),
      });
    }
    this.validate(schema, payload, `Invalid payload for ${action}`);
  }

  private validate(schema: JsonSchema, data: unknown, message: string): void {
    let validate = this.compiled.get(schema);
    if (!validate) {
      validate = this.ajv.compile(schema);
      this.compiled.set(schema, validate);
    }
    if (!validate(data)) {
      throw new UnprocessableEntityException({
        message,
        errors: validate.errors?.map(({ instancePath, message: reason }) => ({
          path: instancePath || '/',
          message: reason,
        })),
      });
    }
  }
}
