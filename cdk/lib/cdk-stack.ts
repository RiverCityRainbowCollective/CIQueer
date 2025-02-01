import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable "${name}" is missing`);
  }
  return value;
}

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create VPC
    const vpc = new cdk.aws_ec2.Vpc(this, 'MainVPC', {
      natGateways: 0,
      subnetConfiguration: [{
        cidrMask: 24,
        name: 'Public',
        subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
      }],
    });

    // Create Security Group
    const securityGroup = new cdk.aws_ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      description: 'Allow specific ports in',
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(
      cdk.aws_ec2.Peer.anyIpv4(),
      cdk.aws_ec2.Port.HTTPS,
      'Allow Access to HTTPS 443'
    );

    const az = vpc.publicSubnets[0].availabilityZone

    // Create EBS Volume
    const ebsVolume = new cdk.aws_ec2.Volume(this, 'EBSVolume', {
      availabilityZone: az,
      size: cdk.Size.gibibytes(20),
      volumeType: cdk.aws_ec2.EbsDeviceVolumeType.GP3,
    });

    // Create EC2 Instance
    const instance = new cdk.aws_ec2.Instance(this, 'EC2Instance', {
      vpc,
      availabilityZone: az,
      vpcSubnets: {
        subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
      },
      securityGroup: securityGroup,
      instanceType: cdk.aws_ec2.InstanceType.of(
        cdk.aws_ec2.InstanceClass.T2,
        cdk.aws_ec2.InstanceSize.MICRO
      ),
      machineImage: new cdk.aws_ec2.AmazonLinuxImage({
        generation: cdk.aws_ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      })
    });

    const device = '/dev/xvdf'
    // Attach EBS Volume to EC2 Instance
    new cdk.aws_ec2.CfnVolumeAttachment(this, 'EBSAttachment', {
      device: device,
      instanceId: instance.instanceId,
      volumeId: ebsVolume.volumeId,
    });

    // Add user data to install postgres and run initialization script
    const userData = cdk.aws_ec2.UserData.forLinux();
    userData.addCommands(
      // Update system and install postgres
      'yum update -y',
      'yum install -y postgresql15 postgresql15-server'
    );

    instance.userData.addCommands(
      'cat << EOF >> /etc/environment',
      'DATABASE_URL=postgresql://localhost:5432',
      `DATBASE_NAME=${getRequiredEnvVar('DATABASE_NAME')}`,
      `DATBASE_USER=${getRequiredEnvVar('DATABASE_USER')}`,
      `DATBASE_PASSWORD=${getRequiredEnvVar('DATABASE_PASSWORD')}`,
      'NODE_ENV=production',
      'EOF'
    );

    // Add the init script
    userData.addExecuteFileCommand({
      filePath: path.join(__dirname, 'init.sh'),
      arguments: `${device}, ${getRequiredEnvVar('DATABASE_NAME')}, ${getRequiredEnvVar('DATABASE_USER')}, ${getRequiredEnvVar('DATABASE_PASSWORD')}`, // Pass any arguments your script needs
    });


    // Add the user data to the instance
    instance.addUserData(userData.render());

    // Create and Associate Elastic IP
    const eip = new cdk.aws_ec2.CfnEIP(this, 'InstanceEIP');
    
    new cdk.aws_ec2.CfnEIPAssociation(this, 'EIPAssociation', {
      eip: eip.ref,
      instanceId: instance.instanceId,
    });

    // Output the instance public IP and EIP
    new cdk.CfnOutput(this, 'InstancePublicIP', {
      value: instance.instancePublicIp,
      description: 'Public IP of EC2 Instance',
    });

    new cdk.CfnOutput(this, 'ElasticIP', {
      value: eip.ref,
      description: 'Elastic IP attached to Instance',
    });
  }
}
