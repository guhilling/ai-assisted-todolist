# Message from Gunnar

![Gunnar Hilling](images/gunnar-hilling.jpg)

## About me

I'm a physicist, software developer and architect, and an expert in Kubernetes
and automation.
You can find more details on [my company website](https://hilling.it).

## Why this page? Isn't there enough documentation anyway?

Yes, there is. But I wanted to write at least a little of it myself for this project. Everything else was created by [Claude](https://claude.ai):

* The actual code:
    * Backend in [Go](https://go.dev) (using [AWS Lambda](https://aws.amazon.com/lambda/))
    * Frontend in [React](https://react.dev)/[TypeScript](https://www.typescriptlang.org)
    * Mobile apps for iOS and Android from a single [Expo](https://expo.dev) codebase
* Unit tests
* Integration tests
* End-to-end tests
* [GitHub](https://github.com/guhilling/ai-assisted-todolist)
Actions workflows (CI and releases)
* [SonarQube Cloud](https://sonarcloud.io/project/overview?id=guhilling_ai-assisted-todolist) and [CodeRabbit](https://www.coderabbit.ai) reviews
* [OpenTofu](https://opentofu.org) configuration files for setting up 
[AWS](https://aws.amazon.com) resources and deployment
* [Perses](https://perses.dev) dashboards hosted on a [Hetzner](https://www.hetzner.com/) server

For details, please read the great [official documentation](README.md).

It's also worth mentioning that the first implementation of this project
used [Quarkus](https://quarkus.io) in the backend as I'm really fluent
in [Java](https://www.java.com) in general and Quarkus in particular.

For several reasons (mainly financial ones) I wanted a second version,
and I deliberately chose Go, precisely because _I'm not really familiar with it_.

So for the implementation, testing and documentation,
I relied completely on Claude.

Of course, it's still important to make sure the right guardrails
are in place and the project takes the right direction... but then again, it's really stunning what AI can do today.

## Purpose

This is mainly a demo project.

For a more detailed description, see the [purpose page](purpose.md) that
is maintained automatically and so is probably more up to date than this one.
