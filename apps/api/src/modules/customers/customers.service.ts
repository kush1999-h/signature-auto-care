import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Customer,
  CustomerDocument,
  Vehicle,
  VehicleDocument,
} from "../../schemas";

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private customerModel: Model<CustomerDocument>,
    @InjectModel(Vehicle.name) private vehicleModel: Model<VehicleDocument>
  ) {}

  async createCustomer(data: Partial<Customer>) {
    return this.customerModel.create(data);
  }

  async listCustomers() {
    return this.customerModel.find().exec();
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
    return this.vehicleModel.find({ customerId }).exec();
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
      .exec();
    return customers;
  }
}
