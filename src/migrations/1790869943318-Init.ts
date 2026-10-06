import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Device types seeded with the schema. Controls are derived from plain JSON Schema:
 * boolean → switch, bounded integer → slider, enum → dropdown, #RRGGBB pattern → colour picker.
 * Settings live in stateSchema (desired/reported); one-shot actions in commands.
 */
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length && { required }),
});
const reboot = object({});

const DEVICE_TYPES = [
  {
    key: 'fanled',
    name: 'Fan + LED controller',
    stateSchema: object({
      speed: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        title: 'Fan speed (%)',
      },
      light: { type: 'boolean', title: 'Light' },
    }),
    commands: { reboot },
  },
  {
    key: 'rgb_bar',
    name: 'RGB bar light',
    stateSchema: object({
      on: { type: 'boolean', title: 'Power' },
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', title: 'Colour' },
      brightness: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        title: 'Brightness (%)',
      },
    }),
    commands: {
      play_effect: object(
        {
          effect: {
            type: 'string',
            enum: ['rainbow', 'breathe', 'strobe'],
            title: 'Effect',
          },
          durationSec: {
            type: 'integer',
            minimum: 1,
            maximum: 3600,
            title: 'Duration (s)',
          },
        },
        ['effect'],
      ),
      reboot,
    },
  },
  {
    key: 'camera',
    name: 'Camera (ESP32-CAM)',
    stateSchema: object({
      resolution: {
        type: 'string',
        enum: ['QVGA', 'VGA', 'SVGA', 'XGA', 'HD', 'SXGA', 'UXGA'],
        title: 'Resolution',
      },
      quality: {
        type: 'integer',
        minimum: 10,
        maximum: 63,
        title: 'JPEG quality (10 best – 63 smallest)',
      },
      vflip: { type: 'boolean', title: 'Flip vertically' },
      hmirror: { type: 'boolean', title: 'Mirror horizontally' },
    }),
    commands: {
      snapshot: object({
        quality: {
          type: 'integer',
          minimum: 10,
          maximum: 63,
          title: 'JPEG quality',
        },
      }),
      reboot,
    },
  },
];

export class Init1790869943318 implements MigrationInterface {
  name = 'Init1790869943318';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Trusted extension: the database owner can create it (Postgres 13+).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying NOT NULL, "email" citext NOT NULL, "passwordHash" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" uuid NOT NULL, "tokenHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "revokedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_c25bc63d248ca90e8dcc1d92d06" UNIQUE ("tokenHash"), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_610102b60fea1455310ccd299d" ON "refresh_tokens"  ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "device_types" ("key" character varying NOT NULL, "name" character varying NOT NULL, "stateSchema" jsonb NOT NULL, "commands" jsonb NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8aa48acb7f8df96864a1681d7fb" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "org_members" ("orgId" uuid NOT NULL, "userId" uuid NOT NULL, "role" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_3204ad6d040a8778b5ab596f24" CHECK ("role" IN ('viewer', 'operator', 'admin', 'owner')), CONSTRAINT "PK_8c68dcccbec3424e872ce05444c" PRIMARY KEY ("orgId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8ecb45efcca47ab7ec12c27441" ON "org_members"  ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "locations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "orgId" uuid NOT NULL, "name" character varying NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_5971491f7171e651890cb8e9746" UNIQUE ("orgId", "name"), CONSTRAINT "PK_7cc1c9e3853b94816c094825e74" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "devices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "hardwareId" character varying NOT NULL, "typeKey" character varying NOT NULL, "orgId" uuid, "locationId" uuid, "name" character varying, "secretHash" character varying NOT NULL, "claimCodeHash" character varying, "desiredState" jsonb NOT NULL DEFAULT '{}', "reportedState" jsonb NOT NULL DEFAULT '{}', "stateVersion" integer NOT NULL DEFAULT '0', "firmwareVersion" character varying, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "claimedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_4fefc34145987ba742355895223" UNIQUE ("hardwareId"), CONSTRAINT "PK_b1514758245c12daf43486dd1f0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c9335660e07b8cc8702810c58f" ON "devices"  ("orgId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6b0ab91dc6cd8d205fa2379fe1" ON "devices"  ("locationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "commands" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "deviceId" uuid NOT NULL, "issuedBy" uuid, "action" character varying NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "status" character varying NOT NULL DEFAULT 'pending', "result" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "sentAt" TIMESTAMP WITH TIME ZONE, "ackedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "CHK_aa0d80a5ecc322f7072facbe72" CHECK ("status" IN ('pending', 'sent', 'succeeded', 'failed', 'expired')), CONSTRAINT "PK_7ac292c3aa19300482b2b190d1e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e342534be5cfd406883ab1df35" ON "commands"  ("deviceId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_610102b60fea1455310ccd299de" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_members" ADD CONSTRAINT "FK_9b9af9bcad85b24fba0a20f6883" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_members" ADD CONSTRAINT "FK_8ecb45efcca47ab7ec12c274417" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "locations" ADD CONSTRAINT "FK_f61e5ce98221774c37584242116" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "devices" ADD CONSTRAINT "FK_10bf2283629e9537e013651bed8" FOREIGN KEY ("typeKey") REFERENCES "device_types"("key") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "devices" ADD CONSTRAINT "FK_c9335660e07b8cc8702810c58f9" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "devices" ADD CONSTRAINT "FK_6b0ab91dc6cd8d205fa2379fe15" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commands" ADD CONSTRAINT "FK_47935ef1e42f6dead5db8c02aec" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "commands" ADD CONSTRAINT "FK_1871504ec130361dc5ea212296c" FOREIGN KEY ("issuedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    // Telemetry: partitioned by month. TelemetryService creates upcoming partitions;
    // the default partition only catches out-of-range timestamps.
    await queryRunner.query(
      `CREATE TABLE "telemetry" ("deviceId" uuid NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE, "ts" TIMESTAMP WITH TIME ZONE NOT NULL, "metrics" jsonb NOT NULL, PRIMARY KEY ("deviceId", "ts")) PARTITION BY RANGE ("ts")`,
    );
    await queryRunner.query(
      `CREATE TABLE "telemetry_default" PARTITION OF "telemetry" DEFAULT`,
    );

    for (const type of DEVICE_TYPES) {
      await queryRunner.query(
        `INSERT INTO "device_types" ("key", "name", "stateSchema", "commands") VALUES ($1, $2, $3, $4)`,
        [
          type.key,
          type.name,
          JSON.stringify(type.stateSchema),
          JSON.stringify(type.commands),
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "telemetry"`);
    await queryRunner.query(
      `ALTER TABLE "commands" DROP CONSTRAINT "FK_1871504ec130361dc5ea212296c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "commands" DROP CONSTRAINT "FK_47935ef1e42f6dead5db8c02aec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "devices" DROP CONSTRAINT "FK_6b0ab91dc6cd8d205fa2379fe15"`,
    );
    await queryRunner.query(
      `ALTER TABLE "devices" DROP CONSTRAINT "FK_c9335660e07b8cc8702810c58f9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "devices" DROP CONSTRAINT "FK_10bf2283629e9537e013651bed8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "locations" DROP CONSTRAINT "FK_f61e5ce98221774c37584242116"`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_members" DROP CONSTRAINT "FK_8ecb45efcca47ab7ec12c274417"`,
    );
    await queryRunner.query(
      `ALTER TABLE "org_members" DROP CONSTRAINT "FK_9b9af9bcad85b24fba0a20f6883"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_610102b60fea1455310ccd299de"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e342534be5cfd406883ab1df35"`,
    );
    await queryRunner.query(`DROP TABLE "commands"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6b0ab91dc6cd8d205fa2379fe1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c9335660e07b8cc8702810c58f"`,
    );
    await queryRunner.query(`DROP TABLE "devices"`);
    await queryRunner.query(`DROP TABLE "locations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8ecb45efcca47ab7ec12c27441"`,
    );
    await queryRunner.query(`DROP TABLE "org_members"`);
    await queryRunner.query(`DROP TABLE "organizations"`);
    await queryRunner.query(`DROP TABLE "device_types"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_610102b60fea1455310ccd299d"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
