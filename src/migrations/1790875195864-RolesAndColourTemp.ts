import type { MigrationInterface, QueryRunner } from 'typeorm';

/** rgb_bar gains a white mode with colour temperature (monitor bar light). */
const RGB_BAR_STATE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    on: { type: 'boolean', title: 'Power' },
    mode: { type: 'string', enum: ['color', 'white'], title: 'Mode' },
    color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', title: 'Colour' },
    colorTemp: {
      type: 'integer',
      minimum: 2700,
      maximum: 6500,
      title: 'Colour temperature (K)',
    },
    brightness: {
      type: 'integer',
      minimum: 0,
      maximum: 100,
      title: 'Brightness (%)',
    },
  },
};

export class RolesAndColourTemp1790875195864 implements MigrationInterface {
  name = 'RolesAndColourTemp1790875195864';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "org_members" DROP CONSTRAINT "CHK_3204ad6d040a8778b5ab596f24"`,
    );
    // Org roles are now viewer < member < owner; platform staff live on users.platformRole.
    await queryRunner.query(
      `UPDATE "org_members" SET "role" = CASE "role" WHEN 'operator' THEN 'member' WHEN 'admin' THEN 'owner' ELSE "role" END`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD "platformRole" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD "rotatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_c78bf3747eb91116197a7a9d20" CHECK ("platformRole" IN ('super_admin', 'developer'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_members" ADD CONSTRAINT "CHK_7c192dff903156f173526ed321" CHECK ("role" IN ('viewer', 'member', 'owner'))`,
    );
    await queryRunner.query(
      `UPDATE "device_types" SET "name" = 'Monitor bar light (RGB)', "stateSchema" = $1 WHERE "key" = 'rgb_bar'`,
      [JSON.stringify(RGB_BAR_STATE)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "org_members" DROP CONSTRAINT "CHK_7c192dff903156f173526ed321"`,
    );
    await queryRunner.query(
      `UPDATE "org_members" SET "role" = 'operator' WHERE "role" = 'member'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CHK_c78bf3747eb91116197a7a9d20"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "platformRole"`);
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP COLUMN "rotatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_members" ADD CONSTRAINT "CHK_3204ad6d040a8778b5ab596f24" CHECK (((role)::text = ANY ((ARRAY['viewer'::character varying, 'operator'::character varying, 'admin'::character varying, 'owner'::character varying])::text[])))`,
    );
  }
}
