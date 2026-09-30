# The whole difference between this environment and the other one.

region      = "eu-central-1"
project     = "todolist"
environment = "prod"

vpc_cidr             = "10.30.0.0/16"
public_subnet_cidrs  = ["10.30.0.0/20", "10.30.16.0/20"]
private_subnet_cidrs = ["10.30.128.0/20", "10.30.144.0/20"]
