#include <iostream>
#include <string>
using namespace std;

int main() {
    long long left = -1000000000LL, right = 1000000000LL;
    while (left <= right) {
        long long middle = left + (right - left) / 2;
        cout << middle << endl;  // 交互题每次询问后必须立即刷新输出。
        string reply;
        if (!(cin >> reply) || reply == "equal") return 0;
        if (reply == "big") right = middle - 1;
        else if (reply == "small") left = middle + 1;
        else return 0;
    }
    return 0;
}
