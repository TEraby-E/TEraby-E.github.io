#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int q;
    if (!(cin >> q)) return 0;
    vector<int> stack(q);
    int size = 0;
    cin.ignore(numeric_limits<streamsize>::max(), '\n');
    while (q--) {
        string line, op, extra;
        getline(cin, line);
        istringstream command(line);
        command >> op;
        int value;
        if ((op == "push" && !(command >> value)) || (command >> extra)) {
            cout << "ERROR\n";
            continue;
        }
        if (op == "push") {
            stack[size++] = value;
        } else if (op == "pop") {
            if (size == 0) cout << "ERROR\n";
            else --size;
        } else if (op == "top") {
            if (size == 0) cout << "ERROR\n";
            else cout << stack[size - 1] << '\n';
        } else if (op == "size") {
            cout << size << '\n';
        } else if (op == "clear") {
            size = 0;
        } else if (op == "empty") {
            cout << (size == 0 ? "YES" : "NO") << '\n';
        } else {
            cout << "ERROR\n";
        }
    }
}
