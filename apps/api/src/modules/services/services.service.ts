import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Service, ServiceDocument } from "../../schemas";

type ListParams = {
  search?: string;
  activeOnly?: boolean;
};

type UpsertPayload = {
  name?: string;
  code?: string;
  category?: string;
  defaultPrice?: number;
  defaultCost?: number;
  taxable?: boolean;
  isActive?: boolean;
};

@Injectable()
export class ServicesService {
  constructor(@InjectModel(Service.name) private serviceModel: Model<ServiceDocument>) {}

  private decimalFromNumber(val: number) {
    return Types.Decimal128.fromString((val || 0).toString());
  }

  async list(params: ListParams = {}) {
    const filter: Record<string, unknown> = {};
    if (params.search) {
      const re = new RegExp(params.search.trim(), "i");
      filter.$or = [{ name: re }, { code: re }, { category: re }];
    }
    if (params.activeOnly) {
      filter.isActive = true;
    }
    return this.serviceModel.find(filter).sort({ name: 1 }).exec();
  }

  async create(payload: UpsertPayload) {
    const name = payload.name?.trim();
    const code = payload.code?.trim().toUpperCase();
    const price = Number(payload.defaultPrice);
    const cost = payload.defaultCost !== undefined ? Number(payload.defaultCost) : 0;
    if (!name) throw new BadRequestException("name is required");
    if (!code) throw new BadRequestException("code is required");
    if (!Number.isFinite(price) || price < 0) {
      throw new BadRequestException("defaultPrice must be a non-negative number");
    }
    if (!Number.isFinite(cost) || cost < 0) {
      throw new BadRequestException("defaultCost must be a non-negative number");
    }
    const exists = await this.serviceModel.findOne({ code });
    if (exists) throw new ConflictException("Service code already exists");
    return this.serviceModel.create({
      name,
      code,
      category: payload.category?.trim() || undefined,
      defaultPrice: this.decimalFromNumber(price),
      defaultCost: this.decimalFromNumber(cost),
      taxable: Boolean(payload.taxable),
      isActive: payload.isActive !== undefined ? Boolean(payload.isActive) : true,
    });
  }

  async update(id: string, payload: UpsertPayload) {
    const update: Record<string, unknown> = {};
    if (payload.name !== undefined) {
      update.name = payload.name.trim();
    }
    if (payload.code !== undefined) {
      const code = payload.code.trim().toUpperCase();
      const existing = await this.serviceModel.findOne({ code, _id: { $ne: id } });
      if (existing) throw new ConflictException("Service code already exists");
      update.code = code;
    }
    if (payload.category !== undefined) {
      update.category = payload.category.trim() || undefined;
    }
    if (payload.defaultPrice !== undefined) {
      const price = Number(payload.defaultPrice);
      if (!Number.isFinite(price) || price < 0) {
        throw new BadRequestException("defaultPrice must be a non-negative number");
      }
      update.defaultPrice = this.decimalFromNumber(price);
    }
    if (payload.defaultCost !== undefined) {
      const cost = Number(payload.defaultCost);
      if (!Number.isFinite(cost) || cost < 0) {
        throw new BadRequestException("defaultCost must be a non-negative number");
      }
      update.defaultCost = this.decimalFromNumber(cost);
    }
    if (payload.taxable !== undefined) {
      update.taxable = Boolean(payload.taxable);
    }
    if (payload.isActive !== undefined) {
      update.isActive = Boolean(payload.isActive);
    }
    const doc = await this.serviceModel.findByIdAndUpdate(id, update, { new: true });
    if (!doc) throw new NotFoundException("Service not found");
    return doc;
  }

  async updatePrice(id: string, payload: { defaultPrice?: number; defaultCost?: number }) {
    return this.update(id, payload);
  }
}

