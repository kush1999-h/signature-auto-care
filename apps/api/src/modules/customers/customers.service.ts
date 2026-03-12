import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Customer,
  CustomerDocument,
  Vehicle,
  VehicleDocument,
  WorkOrder,
  WorkOrderDocument,
} from "../../schemas";

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(Vehicle.name) private vehicleModel: Model<VehicleDocument>,
    @InjectModel(WorkOrder.name) private workOrderModel: Model<WorkOrderDocument>
  ) {}

  private getVisitAnchor(workOrder: {
    deliveredAt?: Date | string | null;
    dateIn?: Date | string | null;
    createdAt?: Date | string | null;
  }) {
    return workOrder.deliveredAt || workOrder.dateIn || workOrder.createdAt || null;
  }

  private normalizePlate(plate?: string | null) {
    return (plate || "").trim().toUpperCase();
  }

  private async buildCustomerSummaries(customers: Array<{ _id: { toString: () => string } }>) {
    const customerIds = customers.map((customer) => customer._id);
    const [vehicles, workOrders] = await Promise.all([
      this.vehicleModel.find({ customerId: { $in: customerIds } }).lean(),
      this.workOrderModel
        .find({ customerId: { $in: customerIds } })
        .select("customerId vehicleId deliveredAt dateIn createdAt")
        .lean(),
    ]);

    const distinctVehiclesByCustomer = new Map<string, number>();
    vehicles.forEach((vehicle) => {
      const customerId = vehicle.customerId?.toString();
      if (!customerId) return;
      distinctVehiclesByCustomer.set(
        customerId,
        (distinctVehiclesByCustomer.get(customerId) || 0) + 1
      );
    });

    const visitsByCustomer = new Map<
      string,
      { totalVisits: number; lastVisit: Date | null }
    >();
    workOrders.forEach((workOrder) => {
      const customerId = workOrder.customerId?.toString();
      if (!customerId) return;
      const anchor = this.getVisitAnchor(workOrder);
      const current = visitsByCustomer.get(customerId) || {
        totalVisits: 0,
        lastVisit: null,
      };
      const nextVisit = anchor ? new Date(anchor) : null;
      visitsByCustomer.set(customerId, {
        totalVisits: current.totalVisits + 1,
        lastVisit:
          current.lastVisit && nextVisit
            ? current.lastVisit > nextVisit
              ? current.lastVisit
              : nextVisit
            : current.lastVisit || nextVisit,
      });
    });

    return new Map(
      customers.map((customer) => {
        const customerId = customer._id.toString();
        const visitInfo = visitsByCustomer.get(customerId) || {
          totalVisits: 0,
          lastVisit: null,
        };
        return [
          customerId,
          {
            totalVisits: visitInfo.totalVisits,
            distinctVehicles: distinctVehiclesByCustomer.get(customerId) || 0,
            lastVisit: visitInfo.lastVisit,
          },
        ];
      })
    );
  }

  async createCustomer(data: Partial<Customer>) {
    return this.customerModel.create(data);
  }

  async listCustomers() {
    const customers = await this.customerModel.find().lean().exec();
    const summaries = await this.buildCustomerSummaries(customers);
    return customers.map((customer) => ({
      ...customer,
      visitSummary: summaries.get(customer._id.toString()) || {
        totalVisits: 0,
        distinctVehicles: 0,
        lastVisit: null,
      },
    }));
  }

  async getCustomer(id: string) {
    const customer = await this.customerModel.findById(id).exec();
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  async updateCustomer(id: string, data: Partial<Customer>) {
    const customer = await this.customerModel.findByIdAndUpdate(id, data, {
      new: true,
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }

  async addVehicle(data: Partial<Vehicle>) {
    return this.vehicleModel.create(data);
  }

  async listVehiclesByCustomer(customerId: string) {
    const vehicles = await this.vehicleModel.find({ customerId }).lean().exec();
    const workOrders = vehicles.length
      ? await this.workOrderModel
          .find({ customerId })
          .select("vehicleId deliveredAt dateIn createdAt")
          .lean()
          .exec()
      : [];
    const workOrderVehicleIds = Array.from(
      new Set(workOrders.map((workOrder) => workOrder.vehicleId?.toString()).filter(Boolean))
    );
    const workOrderVehicles = workOrderVehicleIds.length
      ? await this.vehicleModel
          .find({ _id: { $in: workOrderVehicleIds } })
          .select("_id plate")
          .lean()
          .exec()
      : [];
    const plateByVehicleId = new Map(
      workOrderVehicles.map((vehicle) => [
        vehicle._id.toString(),
        this.normalizePlate(vehicle.plate),
      ])
    );

    const statsByVehicle = new Map<
      string,
      { visitCount: number; firstVisit: Date | null; lastVisit: Date | null }
    >();
    const statsByPlate = new Map<
      string,
      { visitCount: number; firstVisit: Date | null; lastVisit: Date | null }
    >();
    workOrders.forEach((workOrder) => {
      const vehicleId = workOrder.vehicleId?.toString();
      if (!vehicleId) return;
      const anchor = this.getVisitAnchor(workOrder);
      const anchorDate = anchor ? new Date(anchor) : null;
      const current = statsByVehicle.get(vehicleId) || {
        visitCount: 0,
        firstVisit: null,
        lastVisit: null,
      };
      statsByVehicle.set(vehicleId, {
        visitCount: current.visitCount + 1,
        firstVisit:
          current.firstVisit && anchorDate
            ? current.firstVisit < anchorDate
              ? current.firstVisit
              : anchorDate
            : current.firstVisit || anchorDate,
        lastVisit:
          current.lastVisit && anchorDate
            ? current.lastVisit > anchorDate
              ? current.lastVisit
              : anchorDate
            : current.lastVisit || anchorDate,
      });

      const plateKey = plateByVehicleId.get(vehicleId);
      if (!plateKey) return;
      const currentByPlate = statsByPlate.get(plateKey) || {
        visitCount: 0,
        firstVisit: null,
        lastVisit: null,
      };
      statsByPlate.set(plateKey, {
        visitCount: currentByPlate.visitCount + 1,
        firstVisit:
          currentByPlate.firstVisit && anchorDate
            ? currentByPlate.firstVisit < anchorDate
              ? currentByPlate.firstVisit
              : anchorDate
            : currentByPlate.firstVisit || anchorDate,
        lastVisit:
          currentByPlate.lastVisit && anchorDate
            ? currentByPlate.lastVisit > anchorDate
              ? currentByPlate.lastVisit
              : anchorDate
            : currentByPlate.lastVisit || anchorDate,
      });
    });

    return vehicles.map((vehicle) => ({
      ...vehicle,
      visitSummary:
        statsByVehicle.get(vehicle._id.toString()) ||
        statsByPlate.get(this.normalizePlate(vehicle.plate)) || {
          visitCount: 0,
          firstVisit: null,
          lastVisit: null,
        },
    }));
  }

  async updateVehicle(id: string, data: Partial<Vehicle>) {
    const vehicle = await this.vehicleModel.findByIdAndUpdate(id, data, {
      new: true,
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    return vehicle;
  }

  async getVehicle(id: string) {
    const vehicle = await this.vehicleModel.findById(id);
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    return vehicle;
  }

  async searchCustomerByPhone(phone: string) {
    if (!phone || phone.trim().length < 3) {
      throw new Error("Phone number must be at least 3 characters");
    }
    // Search with partial phone number match
    const customers = await this.customerModel
      .find({
        phone: { $regex: phone.trim(), $options: "i" },
      })
      .lean()
      .exec();
    const summaries = await this.buildCustomerSummaries(customers);
    return customers.map((customer) => ({
      ...customer,
      visitSummary: summaries.get(customer._id.toString()) || {
        totalVisits: 0,
        distinctVehicles: 0,
        lastVisit: null,
      },
    }));
  }
}
